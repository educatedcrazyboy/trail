#!/usr/bin/env node
// Deterministic, no-model local HTTP mock benchmark. Loopback only; no providers,
// browsers, external URLs, child processes, or caches. See docs/audit/local-protocol.md.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { judge } from './local-oracle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export class LocalError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

export const sha256 = (d) => crypto.createHash('sha256').update(d).digest('hex');
const sortKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
};
export const canonical = (v) => JSON.stringify(sortKeys(v));
const pretty = (v) => JSON.stringify(v, null, 2) + '\n';

const DISCLAIMER =
  'Deterministic local mock with no model, browser, or provider. It makes no claim about AI, browser, runtime, fairness, or performance.';

// ---------- protocol loading and pin verification ----------
export function loadProtocol(protocolPath) {
  const protocolRaw = fs.readFileSync(protocolPath);
  const protocol = JSON.parse(protocolRaw);
  const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const invalid = (detail) => { throw new LocalError('protocol_invalid', detail); };
  if (!obj(protocol) || protocol.schema !== 'trail-local-protocol/1') invalid('schema');
  // Validate every repository path before reading any pinned source or fixture.
  const sources = [
    ['runner', protocol.runner, 'bench/local.mjs'],
    ['oracle', protocol.oracle, 'bench/local-oracle.mjs'],
    ['fixtures.local', protocol.fixtures?.local, 'bench/fixtures/local.json'],
    ['fixtures.adversarial', protocol.fixtures?.adversarial, 'bench/fixtures/local-adversarial.json'],
  ];
  for (const [name, spec, expected] of sources) {
    if (!obj(spec) || spec.path !== expected || !/^[a-f0-9]{64}$/.test(spec.sha256)) invalid(name);
    const resolved = path.join(ROOT, expected);
    if (fs.realpathSync(resolved) !== resolved) invalid(`${name}.symlink`);
  }
  if (!obj(protocol.tasks) || !obj(protocol.treatment) || !obj(protocol.model) ||
      !obj(protocol.limits) || !obj(protocol.conditions) || !obj(protocol.schedule) ||
      !Array.isArray(protocol.schedule.orders) || !obj(protocol.rules)) invalid('structure');
  for (const key of ['armFailure', 'oracle', 'aggregation', 'exit', 'reuse']) {
    if (typeof protocol.rules[key] !== 'string' || !protocol.rules[key]) invalid(`rules.${key}`);
  }
  const expectedConditions = {
    cold: { route: 'navigation' },
    'trail-on': { route: 'shortcut' },
    'trail-off': { route: 'navigation' },
  };
  if (canonical(protocol.conditions) !== canonical(expectedConditions)) invalid('conditions');
  if (protocol.schedule.armsPerOrder !== 3 || protocol.schedule.tasksPerArm !== 4 ||
      !protocol.schedule.orders.every(Array.isArray)) invalid('schedule');
  if (protocol.model.invoked !== false || protocol.treatment.emittedByTrail !== false ||
      protocol.treatment.id !== 'synthetic-route-shortcut' ||
      protocol.treatment.label !== 'synthetic policy, not measured Trail advantage') invalid('synthetic policy');
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel));
  const pin = (name, bytes, want) => {
    if (sha256(bytes) !== want) throw new LocalError('pin_mismatch', name);
  };
  pin('runner', read(protocol.runner.path), protocol.runner.sha256);
  const localRaw = read(protocol.fixtures.local.path);
  const advRaw = read(protocol.fixtures.adversarial.path);
  pin('fixtures.local', localRaw, protocol.fixtures.local.sha256);
  pin('fixtures.adversarial', advRaw, protocol.fixtures.adversarial.sha256);
  pin('oracle', read(protocol.oracle.path), protocol.oracle.sha256);
  const local = JSON.parse(localRaw);
  const adv = JSON.parse(advRaw);
  if (local.schema !== 'trail-local-fixtures/1' || local.synthetic !== true ||
      adv.schema !== 'trail-local-adversarial/1' || !Array.isArray(local.tasks) ||
      !Array.isArray(adv.scenarios)) invalid('fixture schema');
  const taskIds = local.tasks.map((t) => t.id);
  if (taskIds.join() !== 'shipment,stats,paper,video') invalid('task ids');
  if (JSON.stringify(taskIds) !== JSON.stringify(Object.keys(protocol.tasks))) throw new LocalError('pin_mismatch', 'task set');
  for (const t of local.tasks) pin(`task.${t.id}`, canonical(t), protocol.tasks[t.id]);
  const { sha256: tsha, ...treatment } = protocol.treatment;
  pin('treatment', canonical(treatment), tsha);
  if (protocol.model?.id !== 'fixture/local-model' || protocol.model?.effort !== 'not applicable') {
    throw new LocalError('protocol_invalid', 'model/effort');
  }
  const L = protocol.limits;
  for (const k of ['maxCallsPerArm', 'maxCallsTotal', 'maxResponseBytes', 'armWallMs', 'totalWallMs', 'observedTokenCeilingPerArm']) {
    if (!Number.isInteger(L[k]) || L[k] <= 0) throw new LocalError('protocol_invalid', `limits.${k}`);
  }
  if (L.requireObservedTokens !== true) throw new LocalError('protocol_invalid', 'limits.requireObservedTokens');
  const conds = Object.keys(protocol.conditions);
  for (const c of conds) if (!['shortcut', 'navigation'].includes(protocol.conditions[c].route)) throw new LocalError('protocol_invalid', `route.${c}`);
  const orders = protocol.schedule.orders;
  const seen = new Set(orders.map((o) => o.join('>')));
  const perm = (o) => o.length === conds.length && [...o].sort().join() === [...conds].sort().join();
  if (orders.length !== 6 || seen.size !== 6 || !orders.every(perm)) throw new LocalError('protocol_invalid', 'schedule');
  return { protocol, protocolSha: sha256(protocolRaw), local, adv };
}

// ---------- loopback fixture server ----------
export async function startServer(resources) {
  const events = new EventEmitter();
  const log = [];
  const pending = new Set();
  const sockets = new Set();
  const stats = { hangSeen: 0, hangAborted: 0, streamSent: 0, streamTotal: 0 };
  const server = http.createServer((req, res) => {
    const entry = { seq: log.length + 1, arm: req.headers['x-arm'] || '', method: req.method, path: req.url };
    log.push(entry);
    const r = req.method === 'GET' && Object.hasOwn(resources, req.url) ? resources[req.url] : null;
    entry.outcome = r ? r.mode || 'ok' : 'not_found';
    events.emit('request', entry);
    if (!r) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    if (r.mode === 'hang') {
      stats.hangSeen++;
      pending.add(res);
      res.on('close', () => {
        if (pending.delete(res)) stats.hangAborted++;
        events.emit('settled');
      });
      events.emit('hang-request', entry);
      return;
    }
    const headers = { 'content-type': r.type || 'text/plain' };
    if (r.tokens !== null && r.tokens !== undefined) headers['x-synthetic-tokens'] = String(r.tokens);
    if (r.mode === 'stream') {
      res.writeHead(200, headers);
      const chunk = Buffer.alloc(16384, 97);
      let sent = 0;
      stats.streamTotal = Math.max(stats.streamTotal, r.bytes);
      res.on('close', () => {
        stats.streamSent = Math.max(stats.streamSent, sent);
      });
      const pump = () => {
        while (!res.destroyed && sent < r.bytes) {
          sent += chunk.length;
          if (!res.write(chunk)) {
            res.once('drain', pump);
            return;
          }
        }
        if (!res.destroyed) res.end();
      };
      pump();
      return;
    }
    const body = Buffer.from(r.body, 'utf8');
    headers['content-length'] = body.length;
    res.writeHead(200, headers);
    res.end(body);
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => {
      sockets.delete(s);
      events.emit('settled');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  let closed = false;
  return {
    port, events, log, stats,
    async close() {
      if (!closed) {
        closed = true;
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        // Socket/response 'close' events are asynchronous; wait for each to be observed.
        while (sockets.size || pending.size) await once(events, 'settled');
      }
      return {
        serverClosed: !server.listening,
        hangRequestsSeen: stats.hangSeen,
        hangRequestsAborted: stats.hangAborted,
        pendingRequestsRemaining: pending.size,
        openSocketsRemaining: sockets.size,
      };
    },
  };
}

// ---------- budgeted dispatcher ----------
export function makeArmContext(run, arm, signal) {
  return { run, arm, limits: run.limits, signal, calls: 0, tokens: 0, stopped: null, ceilingExceeded: false };
}

function fetchBounded(ctx, p) {
  const max = ctx.limits.maxResponseBytes;
  return new Promise((resolve, reject) => {
    let done = false;
    const fail = (e) => {
      if (done) return;
      done = true;
      if (e instanceof LocalError) reject(e);
      else reject(new LocalError(ctx.signal.aborted ? 'deadline_exceeded' : 'transport_error', e?.code || e?.message));
    };
    const req = http.request(
      { host: '127.0.0.1', port: ctx.run.port, path: p, method: 'GET', agent: false, signal: ctx.signal, headers: { 'x-arm': ctx.arm, connection: 'close' } },
      (res) => {
        const chunks = [];
        let bytes = 0;
        res.on('data', (c) => {
          bytes += c.length;
          if (bytes > max) {
            fail(new LocalError('response_too_large'));
            res.destroy();
            req.destroy();
          } else chunks.push(c);
        });
        res.on('end', () => {
          if (done) return;
          done = true;
          resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') });
        });
        res.on('error', fail);
        res.on('close', () => fail(new Error('closed')));
      },
    );
    req.on('error', fail);
    req.end();
  });
}

// All limits are enforced BEFORE the request is sent, except the observed-token
// ceiling, which can only be checked after a response and so stops further dispatch.
export async function dispatch(ctx, p) {
  if (ctx.stopped) throw new LocalError(ctx.stopped);
  if (ctx.signal.aborted) throw new LocalError('deadline_exceeded');
  if (typeof p !== 'string' || !/^\/(?!\/)[A-Za-z0-9._/-]*$/.test(p)) throw new LocalError('url_not_allowed');
  if (ctx.calls >= ctx.limits.maxCallsPerArm || ctx.run.totalCalls >= ctx.limits.maxCallsTotal) throw new LocalError('budget_exceeded');
  ctx.calls++;
  ctx.run.totalCalls++;
  const res = await fetchBounded(ctx, p);
  const raw = res.headers['x-synthetic-tokens'];
  if (raw === undefined || !/^\d+$/.test(raw)) {
    if (ctx.limits.requireObservedTokens) {
      ctx.stopped = 'usage_unknown';
      throw new LocalError('usage_unknown');
    }
  } else {
    ctx.tokens += Number(raw);
    if (ctx.tokens > ctx.limits.observedTokenCeilingPerArm) {
      ctx.stopped = 'token_ceiling_stop';
      ctx.ceilingExceeded = true;
    }
  }
  if (res.status !== 200) throw new LocalError('http_status', String(res.status));
  return res;
}

// ---------- deterministic mock solver (no model) ----------
function solve(task, detail, url, fault) {
  const answer = {};
  for (const [k, pat] of Object.entries(task.solver.patterns)) {
    const m = new RegExp(pat, 'm').exec(detail);
    answer[k] = m ? m[1] : '';
  }
  const q = new RegExp(task.solver.quotePattern, 'm').exec(detail);
  const sub = { task: task.id, answer, source: { url, quote: q ? q[0] : '' } };
  switch (fault) {
    case undefined: case null: break;
    case 'malformed': return JSON.stringify(sub).slice(0, -5);
    case 'wrong_answer': sub.answer[Object.keys(answer)[0]] += '-x'; break;
    case 'drop_source': delete sub.source; break;
    case 'fake_quote': sub.source.quote += ' (verified)'; break;
    case 'unfetched_source': sub.source.url = `/t/${task.id}/unfetched`; break;
    case 'decoy_quote': sub.source.quote = task.solver.decoyQuote; break;
    case 'wrong_page': sub.source.url = task.entry; break;
    case 'whole_body': sub.source.quote = detail; break;
    default: throw new LocalError('fault_unknown', fault);
  }
  return JSON.stringify(sub);
}

async function runTask(ctx, task, condition, scenario) {
  const route = ctx.run.protocol.conditions[condition].route;
  let p = scenario?.entry ?? (route === 'shortcut' ? task.shortcut : task.entry);
  const fetched = {};
  let last;
  for (;;) {
    const r = await dispatch(ctx, p);
    fetched[p] = r.text;
    last = p;
    const m = /^next: (\S+)$/m.exec(r.text);
    if (!m) break;
    p = m[1];
  }
  return { raw: solve(task, fetched[last], last, scenario?.fault), fetched };
}

async function runArm(run, spec, tasks, scenario) {
  const ac = new AbortController();
  const onTotal = () => ac.abort();
  if (run.totalAC.signal.aborted) ac.abort();
  run.totalAC.signal.addEventListener('abort', onTotal, { once: true });
  const timer = setTimeout(() => ac.abort(), run.limits.armWallMs);
  const ctx = makeArmContext(run, spec.id, ac.signal);
  const out = [];
  let errorCode = null;
  try {
    for (const [i, task] of tasks.entries()) {
      const before = ctx.calls;
      try {
        const { raw, fetched } = await runTask(ctx, task, spec.condition, i === 0 ? scenario : null);
        const j = judge(task, raw, fetched);
        out.push({ id: task.id, pass: j.pass, failureCode: j.reasons[0] ?? null, reasons: j.reasons, calls: ctx.calls - before });
      } catch (e) {
        if (!(e instanceof LocalError)) throw e;
        errorCode = e.code;
        out.push({ id: task.id, pass: false, failureCode: e.code, reasons: [e.code], calls: ctx.calls - before });
        for (const rest of tasks.slice(i + 1)) out.push({ id: rest.id, pass: false, failureCode: 'not_run', reasons: ['not_run'], calls: 0 });
        break;
      }
    }
  } finally {
    clearTimeout(timer);
    run.totalAC.signal.removeEventListener('abort', onTotal);
  }
  if (!errorCode && ctx.ceilingExceeded) errorCode = 'token_ceiling_exceeded';
  const pass = !errorCode && out.every((t) => t.pass);
  return {
    id: spec.id, condition: spec.condition, order: spec.order ?? null, route: run.protocol.conditions[spec.condition].route,
    pass, failureCode: errorCode ?? out.find((t) => !t.pass)?.failureCode ?? null,
    errorCode, calls: ctx.calls, syntheticTokens: ctx.tokens, tasks: out,
  };
}

// ---------- full run ----------
export async function runLocal({ protocolPath, outDir, fault = null }) {
  const { protocol, protocolSha, local, adv } = loadProtocol(protocolPath);
  const scenarios = adv.scenarios;
  const faultScenario = fault ? scenarios.find((s) => s.id === fault) : null;
  if (fault && !faultScenario) throw new LocalError('usage', `unknown fault ${fault}`);
  const arms = protocol.schedule.orders.flatMap((order, oi) =>
    order.map((condition) => ({ id: `o${oi + 1}-${condition}`, condition, order: oi + 1 })));
  const links = {
    protocol_sha256: protocolSha,
    runner_sha256: protocol.runner.sha256,
    fixtures_local_sha256: protocol.fixtures.local.sha256,
    fixtures_adversarial_sha256: protocol.fixtures.adversarial.sha256,
    oracle_sha256: protocol.oracle.sha256,
    task_sha256: protocol.tasks,
    treatment_sha256: protocol.treatment.sha256,
  };
  const usage = {
    telemetry: 'synthetic',
    source: 'x-synthetic-tokens response header from the local fixture server',
    requireObservedTokens: true,
    unknownUsageRejected: true,
    observedTokenCeilingPerArm: protocol.limits.observedTokenCeilingPerArm,
    semantics: 'Ceiling is checked after each response and only stops further dispatch; an in-flight request can overshoot it. No paid-model cap is enforced or claimed.',
    paidModelCap: false,
  };
  const treatment = {
    id: protocol.treatment.id, label: protocol.treatment.label,
    emittedByTrail: protocol.treatment.emittedByTrail, measuredTrailAdvantage: false,
  };
  const common = { schema: 'trail-local-mock/1', links, model: protocol.model, limits: protocol.limits, treatment, usage, disclaimer: DISCLAIMER, faultInjected: fault };
  // The parent must already exist. mkdir atomically refuses files, directories,
  // and symlinks (including dangling symlinks), without modifying their contents.
  try {
    fs.mkdirSync(outDir);
  } catch (e) {
    if (e.code === 'EEXIST') throw new LocalError('output_exists', outDir);
    throw e;
  }
  const beforeBytes = pretty({
    ...common, phase: 'before', schedule: { orders: protocol.schedule.orders, arms: arms.map((a) => a.id) },
    rules: protocol.rules, adversarial: scenarios.map((s) => ({ id: s.id, expect: s.expect })),
    requestCount: 0, requestLog: [], actionsStarted: false,
  });
  fs.writeFileSync(path.join(outDir, 'before.json'), beforeBytes);
  const beforeSha = sha256(beforeBytes);

  const resources = {};
  const addResources = (rs, owner) => {
    for (const [k, v] of Object.entries(rs)) {
      if (Object.hasOwn(resources, k)) throw new LocalError('fixture_collision', `${owner}:${k}`);
      resources[k] = v;
    }
  };
  for (const t of local.tasks) addResources(t.resources, t.id);
  for (const s of scenarios) addResources(s.resources ?? {}, s.id);

  const run = { port: 0, limits: protocol.limits, protocol, totalCalls: 0, totalAC: new AbortController() };
  const totalTimer = setTimeout(() => run.totalAC.abort(), protocol.limits.totalWallMs);
  const server = await startServer(resources);
  run.port = server.port;
  const armResults = [];
  const advResults = [];
  let fatal = null;
  let receipt;
  const countFor = (id) => server.log.filter((e) => e.arm === id).length;
  try {
    for (const [i, spec] of arms.entries()) armResults.push(await runArm(run, spec, local.tasks, i === 0 ? faultScenario : null));
    for (const s of scenarios) {
      const id = `adv:${s.id}`;
      const r = await runArm(run, { id, condition: 'trail-off' }, [local.tasks[0]], s);
      const want = s.expectRequests === 'maxCallsPerArm' ? protocol.limits.maxCallsPerArm : s.expectRequests;
      const requests = countFor(id);
      advResults.push({
        id: s.id, expectedCode: s.expect, observedCode: r.failureCode, requests, expectedRequests: want,
        rejectedAsExpected: !r.pass && r.failureCode === s.expect && requests === want,
      });
    }
  } catch (e) {
    fatal = e instanceof LocalError ? e.code : `internal_error: ${e.message}`;
  } finally {
    clearTimeout(totalTimer);
    run.totalAC.abort();
    receipt = await server.close();
  }
  const failures = [];
  if (fatal) failures.push(`fatal:${fatal}`);
  for (const a of armResults) {
    if (!a.pass) failures.push(`${a.id}:${a.failureCode}`);
    if (countFor(a.id) !== a.calls) failures.push(`${a.id}:request_count_mismatch`);
  }
  for (const a of advResults) if (!a.rejectedAsExpected) failures.push(`adv:${a.id}:not_rejected_as_expected`);
  if (armResults.length !== arms.length) failures.push('incomplete_schedule');
  const extra = fs.readdirSync(outDir).filter((f) => f !== 'before.json');
  const cleanup = { ...receipt, cacheFiles: extra, outputFilesBeforeAfterWrite: ['before.json'], deadlineTimersCleared: true, totalCallsDispatched: run.totalCalls };
  if (!cleanup.serverClosed || cleanup.pendingRequestsRemaining || cleanup.openSocketsRemaining || extra.length) failures.push('cleanup_failed');
  if (cleanup.hangRequestsSeen !== cleanup.hangRequestsAborted) failures.push('pending_not_aborted');
  const beforeUnchanged = sha256(fs.readFileSync(path.join(outDir, 'before.json'))) === beforeSha;
  if (!beforeUnchanged) failures.push('before_modified');
  const conditions = {};
  for (const a of armResults) {
    const c = (conditions[a.condition] ??= { route: a.route, arms: 0, passed: 0, calls: 0, syntheticTokens: 0 });
    c.arms++;
    c.passed += a.pass ? 1 : 0;
    c.calls += a.calls;
    c.syntheticTokens += a.syntheticTokens;
    if (a.route === 'shortcut') c.label = protocol.treatment.label;
  }
  const after = pretty({
    ...common, phase: 'after', before_sha256: beforeSha, beforeUnchanged,
    requests: { count: server.log.length, log: server.log },
    arms: armResults, conditions, adversarial: advResults, cleanup,
    result: { pass: failures.length === 0, failures, aggregation: protocol.rules.aggregation },
  });
  fs.writeFileSync(path.join(outDir, 'after.json'), after);
  return { exitCode: failures.length === 0 ? 0 : 2, failures, beforeSha, afterSha: sha256(after), arms: armResults.length };
}

// ---------- CLI ----------
const HELP = `Usage: node bench/local.mjs --protocol <protocol.json> --out <new-directory> [--fault <scenario-id>]

Runs the deterministic local HTTP mock benchmark (no model, loopback only).
  --protocol  preregistered protocol (bench/protocol.json); runner/fixture/task/oracle pins are verified first
  --out       NEW directory under an existing parent; existing paths and symlinks are refused
  --fault     inject one scenario from bench/fixtures/local-adversarial.json into the first arm
Exit codes: 0 all arms pass and every adversarial scenario is rejected as expected; 2 anything else.
`;

export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (['--protocol', '--out', '--fault'].includes(a) && i + 1 < argv.length) o[a.slice(2)] = argv[++i];
    else throw new LocalError('usage', `bad argument ${a}`);
  }
  return o;
}

async function main() {
  try {
    const o = parseArgs(process.argv.slice(2));
    if (o.help) {
      process.stdout.write(HELP);
      return 0;
    }
    if (!o.protocol || !o.out) throw new LocalError('usage', '--protocol and --out are required');
    const r = await runLocal({ protocolPath: path.resolve(o.protocol), outDir: path.resolve(o.out), fault: o.fault ?? null });
    process.stdout.write(JSON.stringify({ pass: r.exitCode === 0, arms: r.arms, failures: r.failures, before_sha256: r.beforeSha, after_sha256: r.afterSha }) + '\n');
    return r.exitCode;
  } catch (e) {
    process.stderr.write(`local: ${e.message}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
