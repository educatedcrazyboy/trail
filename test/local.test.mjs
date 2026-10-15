import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runLocal, startServer, dispatch, makeArmContext, LocalError, loadProtocol, sha256 } from '../bench/local.mjs';
import { judge } from '../bench/local-oracle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTOCOL = path.join(ROOT, 'bench/protocol.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const out = () => path.join(tmp, `out${n++}`);
const read = (d, f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));

// Protocol copy with a short per-arm wall limit so the never-answers scenario stays quick.
const fastProtocol = (mutate = () => {}) => {
  const p = JSON.parse(fs.readFileSync(PROTOCOL, 'utf8'));
  p.limits.armWallMs = 250;
  mutate(p);
  const f = path.join(tmp, `protocol${n++}.json`);
  fs.writeFileSync(f, JSON.stringify(p));
  return f;
};

const limits = { maxCallsPerArm: 2, maxCallsTotal: 50, maxResponseBytes: 1024, observedTokenCeilingPerArm: 100, requireObservedTokens: true };
const page = (tokens, extra = {}) => ({ type: 'text/plain', body: 'x', tokens, ...extra });
const unitRun = async (resources, lim = limits) => {
  const server = await startServer(resources);
  const run = { port: server.port, limits: lim, totalCalls: 0 };
  return { server, run, ctx: (signal = new AbortController().signal) => makeArmContext(run, 'unit', signal) };
};

test('happy run: 18 arms pass, evidence links hashes, cleanup is clean, output is deterministic', async () => {
  const proto = fastProtocol();
  const a = out();
  const b = out();
  const ra = await runLocal({ protocolPath: proto, outDir: a });
  const rb = await runLocal({ protocolPath: proto, outDir: b });
  assert.equal(ra.exitCode, 0, JSON.stringify(ra.failures));
  const before = read(a, 'before.json');
  const after = read(a, 'after.json');
  assert.equal(fs.readFileSync(path.join(a, 'after.json'), 'utf8'), fs.readFileSync(path.join(b, 'after.json'), 'utf8'));
  assert.equal(after.arms.length, 18);
  assert.equal(before.actionsStarted, false);
  assert.equal(before.requestCount, 0);
  assert.equal(after.before_sha256, ra.beforeSha);
  assert.deepEqual(after.links, before.links);
  assert.equal(after.links.runner_sha256, sha256(fs.readFileSync(path.join(ROOT, 'bench/local.mjs'))));
  assert.equal(Object.keys(after.links.task_sha256).join(), 'shipment,stats,paper,video');
  for (const arm of after.arms) {
    assert.equal(arm.tasks.length, 4);
    assert.ok(arm.tasks.every((t) => t.pass));
    assert.equal(arm.calls, arm.route === 'shortcut' ? 4 : 12);
  }
  assert.deepEqual(Object.keys(after.conditions).sort(), ['cold', 'trail-off', 'trail-on']);
  for (const [condition, route] of [['cold', 'navigation'], ['trail-on', 'shortcut'], ['trail-off', 'navigation']]) {
    assert.equal(after.conditions[condition].arms, 6);
    assert.equal(after.conditions[condition].route, route);
  }
  assert.equal(after.conditions['trail-on'].label, 'synthetic policy, not measured Trail advantage');
  assert.equal(after.treatment.emittedByTrail, false);
  assert.equal(after.treatment.measuredTrailAdvantage, false);
  assert.equal(after.usage.telemetry, 'synthetic');
  assert.equal(after.usage.paidModelCap, false);
  assert.equal(after.model.id, 'fixture/local-model');
  assert.equal(after.model.effort, 'not applicable');
  assert.equal(after.cleanup.serverClosed, true);
  assert.equal(after.cleanup.pendingRequestsRemaining, 0);
  assert.equal(after.cleanup.hangRequestsSeen, 1);
  assert.equal(after.cleanup.hangRequestsAborted, 1);
  assert.deepEqual(after.cleanup.cacheFiles, []);
  assert.equal(after.requests.count, after.requests.log.length);
  assert.deepEqual(fs.readdirSync(a).sort(), ['after.json', 'before.json']);
});

test('adversarial scenarios are each rejected with the expected code and request count', async () => {
  const d = out();
  const r = await runLocal({ protocolPath: fastProtocol(), outDir: d });
  assert.equal(r.exitCode, 0, JSON.stringify(r.failures));
  const adv = Object.fromEntries(read(d, 'after.json').adversarial.map((a) => [a.id, a]));
  const codes = Object.fromEntries(Object.entries(adv).map(([k, v]) => [k, v.observedCode]));
  assert.deepEqual(codes, {
    too_many_calls: 'budget_exceeded', oversized_response: 'response_too_large', never_answers: 'deadline_exceeded',
    unknown_usage: 'usage_unknown', token_ceiling: 'token_ceiling_stop', malformed_answer: 'malformed_response',
    wrong_answer: 'wrong_answer', missing_source: 'missing_source', fabricated_quote: 'quote_not_in_source',
    unfetched_source: 'source_not_fetched', decoy_quote: 'quote_missing_value', wrong_source_page: 'wrong_source_page',
    whole_body_quote: 'quote_too_broad',
  });
  assert.ok(Object.values(adv).every((a) => a.rejectedAsExpected));
  // Budget is enforced before dispatch: the server saw exactly the cap, never cap+1.
  assert.equal(adv.too_many_calls.requests, 12);
});

test('every injected fault makes the run exit 2 (nothing falsely passes)', async () => {
  const proto = fastProtocol();
  const ids = JSON.parse(fs.readFileSync(path.join(ROOT, 'bench/fixtures/local-adversarial.json'), 'utf8')).scenarios.map((s) => s.id);
  for (const id of ids) {
    const d = out();
    const r = await runLocal({ protocolPath: proto, outDir: d, fault: id });
    assert.equal(r.exitCode, 2, id);
    const after = read(d, 'after.json');
    assert.equal(after.result.pass, false, id);
    assert.equal(after.arms[0].pass, false, id);
    assert.equal(after.cleanup.pendingRequestsRemaining, 0, id);
  }
});

test('output reuse and pin tampering are refused before any action', async () => {
  const d = out();
  fs.mkdirSync(d);
  await assert.rejects(runLocal({ protocolPath: PROTOCOL, outDir: d }), { code: 'output_exists' });
  assert.deepEqual(fs.readdirSync(d), []);
  const bad = fastProtocol((p) => { p.fixtures.local.sha256 = '0'.repeat(64); });
  const d2 = out();
  await assert.rejects(runLocal({ protocolPath: bad, outDir: d2 }), { code: 'pin_mismatch' });
  assert.equal(fs.existsSync(d2), false);
  const bad2 = fastProtocol((p) => { p.tasks.stats = '0'.repeat(64); });
  assert.throws(() => loadProtocol(bad2), { code: 'pin_mismatch' });
  const bad3 = fastProtocol((p) => { p.schedule.orders[5] = p.schedule.orders[0]; });
  assert.throws(() => loadProtocol(bad3), { code: 'protocol_invalid' });
  assert.throws(() => loadProtocol(fastProtocol((p) => { p.model.effort = 'high'; })), { code: 'protocol_invalid' });
});

test('wrong executor pin refuses the run before creating evidence', async () => {
  const protocolPath = fastProtocol((p) => { p.runner.sha256 = '0'.repeat(64); });
  const d = out();
  await assert.rejects(runLocal({ protocolPath, outDir: d }), { code: 'pin_mismatch', message: 'pin_mismatch: runner' });
  assert.throws(() => fs.lstatSync(d), { code: 'ENOENT' });
});

test('existing directories files and symlink outputs remain unchanged', async () => {
  const target = out();
  fs.mkdirSync(target);
  const sentinel = path.join(target, 'sentinel');
  fs.writeFileSync(sentinel, 'keep');
  const link = out();
  fs.symlinkSync(target, link);
  const dangling = out();
  const missing = out();
  fs.symlinkSync(missing, dangling);
  const file = out();
  fs.writeFileSync(file, 'keep file');
  for (const d of [target, link, dangling, file]) {
    await assert.rejects(runLocal({ protocolPath: PROTOCOL, outDir: d }), { code: 'output_exists' });
  }
  assert.deepEqual(fs.readdirSync(target), ['sentinel']);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
  assert.equal(fs.readlinkSync(link), target);
  assert.equal(fs.readlinkSync(dangling), missing);
  assert.equal(fs.readFileSync(file, 'utf8'), 'keep file');
  assert.throws(() => fs.lstatSync(missing), { code: 'ENOENT' });
  const absentParent = out();
  await assert.rejects(runLocal({ protocolPath: PROTOCOL, outDir: path.join(absentParent, 'child') }), { code: 'ENOENT' });
  assert.throws(() => fs.lstatSync(absentParent), { code: 'ENOENT' });
});

test('schema paths and condition policies are validated before pinned reads', () => {
  const mutations = [
    (p) => { p.schema = 'unknown'; },
    (p) => { p.runner.path = 'bench/../bench/local.mjs'; },
    (p) => { p.oracle.path = '../outside-oracle.mjs'; },
    (p) => { p.fixtures.local.path = '/outside/local.json'; },
    (p) => { p.fixtures.adversarial.path = 'bench/fixtures/../local.json'; },
    (p) => { p.conditions['trail-off'].route = 'shortcut'; },
    (p) => { p.conditions.on = p.conditions['trail-on']; delete p.conditions['trail-on']; },
    (p) => { p.schedule.orders = null; },
    (p) => { p.limits = null; },
  ];
  for (const mutate of mutations) assert.throws(() => loadProtocol(fastProtocol(mutate)), { code: 'protocol_invalid' });
});

test('call budget is enforced before dispatch', async () => {
  const { server, ctx } = await unitRun({ '/a': page(1), '/b': page(1), '/c': page(1) });
  try {
    const c = ctx();
    await dispatch(c, '/a');
    await dispatch(c, '/b');
    await assert.rejects(dispatch(c, '/c'), { code: 'budget_exceeded' });
    assert.equal(server.log.length, 2);
  } finally {
    await server.close();
  }
});

test('non-local and malformed targets are rejected without a request', async () => {
  const { server, ctx } = await unitRun({ '/a': page(1) });
  try {
    for (const p of ['http://example.com/a', '//example.com/a', 'a', '/a?x=1', '/../a b']) {
      await assert.rejects(dispatch(ctx(), p), { code: 'url_not_allowed' }, p);
    }
    assert.equal(server.log.length, 0);
  } finally {
    await server.close();
  }
});

test('response bytes are capped while streaming, not after reading', async () => {
  const total = 64 * 1024 * 1024;
  const { server, ctx } = await unitRun({ '/big': { mode: 'stream', bytes: total, tokens: 1 } });
  try {
    await assert.rejects(dispatch(ctx(), '/big'), { code: 'response_too_large' });
  } finally {
    const receipt = await server.close();
    assert.equal(receipt.openSocketsRemaining, 0);
  }
  assert.ok(server.stats.streamSent > 0);
  assert.ok(server.stats.streamSent < total, `server wrote ${server.stats.streamSent} of ${total}`);
});

test('a request that never answers is aborted at the deadline and cleaned up', async () => {
  const { server, ctx } = await unitRun({ '/hang': { mode: 'hang' } });
  const arrived = once(server.events, 'hang-request', { signal: AbortSignal.timeout(5000) }); // subscribe before triggering
  const c = ctx(AbortSignal.timeout(100));
  const [, [entry]] = await Promise.all([assert.rejects(dispatch(c, '/hang'), { code: 'deadline_exceeded' }), arrived]);
  assert.equal(entry.path, '/hang');
  const receipt = await server.close();
  assert.equal(receipt.hangRequestsSeen, 1);
  assert.equal(receipt.hangRequestsAborted, 1);
  assert.equal(receipt.pendingRequestsRemaining, 0);
  assert.equal(receipt.serverClosed, true);
});

test('unknown usage is rejected when an observed ceiling is required', async () => {
  const { server, ctx } = await unitRun({ '/u': page(null), '/a': page(1) });
  try {
    const c = ctx();
    await assert.rejects(dispatch(c, '/u'), { code: 'usage_unknown' });
    await assert.rejects(dispatch(c, '/a'), { code: 'usage_unknown' });
    assert.equal(server.log.length, 1);
    const relaxed = await unitRun({ '/u': page(null) }, { ...limits, requireObservedTokens: false });
    try {
      assert.equal((await dispatch(relaxed.ctx(), '/u')).status, 200);
    } finally {
      await relaxed.server.close();
    }
  } finally {
    await server.close();
  }
});

test('observed token ceiling stops further dispatch but the in-flight response is delivered', async () => {
  const { server, ctx } = await unitRun({ '/a': page(80), '/b': page(80), '/c': page(1) });
  try {
    const c = ctx();
    await dispatch(c, '/a');
    assert.equal((await dispatch(c, '/b')).status, 200); // overshoot of an in-flight call is not prevented
    assert.equal(c.tokens, 160);
    await assert.rejects(dispatch(c, '/c'), { code: 'token_ceiling_stop' });
    assert.equal(server.log.length, 2);
  } finally {
    await server.close();
  }
});

test('oracle never passes on keywords alone', () => {
  const task = JSON.parse(fs.readFileSync(path.join(ROOT, 'bench/fixtures/local.json'), 'utf8')).tasks[0];
  const detail = task.resources[task.oracle.sourcePath].body;
  const fetched = { [task.oracle.sourcePath]: detail };
  const quote = /^Summary:.*$/m.exec(detail)[0];
  const good = { task: task.id, answer: task.truth, source: { url: task.oracle.sourcePath, quote } };
  assert.equal(judge(task, JSON.stringify(good), fetched).pass, true);
  const cases = {
    keywords_only_text: Object.values(task.truth).join(' '),
    no_source: { ...good, source: undefined },
    extra_field: { ...good, answer: { ...task.truth, extra: 'x' } },
    wrong_value: { ...good, answer: { ...task.truth, status: 'In transit' } },
    stale_quote: { ...good, source: { ...good.source, quote: task.solver.decoyQuote } },
    quote_not_fetched_page: { ...good, source: { url: '/elsewhere', quote } },
    other_task: { ...good, task: 'stats' },
  };
  for (const [name, v] of Object.entries(cases)) {
    const raw = typeof v === 'string' ? v : JSON.stringify(v);
    assert.equal(judge(task, raw, fetched).pass, false, name);
  }
});

test('oracle requires exact authoritative Summary field boundaries without duplicates', () => {
  const task = { id: 'stats', truth: { year: '2024' }, oracle: { sourcePath: '/stats', evidenceFields: ['year'] } };
  const check = (quote, body = quote) => judge(task, JSON.stringify({
    task: 'stats', answer: { year: '2024' }, source: { url: '/stats', quote },
  }), { '/stats': body }).pass;
  assert.equal(check('Summary: year=2024'), true);
  for (const quote of [
    'Summary: year=20240',
    'Summary: fiscal_year=2024',
    'Summary: year=2024; year=2024',
    'Summary: year=2024; year=2025',
    'Summary: year=2025; year=2024',
    'Summary: year=2024; fiscal_year=2024',
    'Previous Summary: year=2024',
    'Summary: year=2024 trailing',
  ]) assert.equal(check(quote), false, quote);
  assert.equal(check('Summary: year=2024', 'Summary: year=20240'), false);
  assert.equal(check('Summary: year=2024', 'Previous Summary: year=2024'), false);
  assert.equal(check('Summary: year=2024', 'Summary: year=2024; year=2025'), false);
  assert.equal(check('Summary: year=2024', 'Summary: year=2024\nSummary: year=2025'), false);
  assert.equal(check('Summary: year=2024', 'Summary: year=2024\nSummary: year=2024'), false);
});

const cli = (args) => spawnSync(process.execPath, [path.join(ROOT, 'bench/local.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, TMPDIR: tmp } });

test('CLI: help, usage errors, happy run and failing run exit codes', () => {
  const help = cli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--protocol/);
  assert.equal(cli(['--bogus']).status, 2);
  assert.equal(cli(['--protocol', PROTOCOL]).status, 2);
  const ok = out();
  const r = cli(['--protocol', PROTOCOL, '--out', ok]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).pass, true);
  assert.equal(cli(['--protocol', PROTOCOL, '--out', ok]).status, 2); // reuse refused
  const bad = out();
  const f = cli(['--protocol', PROTOCOL, '--out', bad, '--fault', 'wrong_answer']);
  assert.equal(f.status, 2);
  assert.equal(JSON.parse(f.stdout).pass, false);
  assert.equal(read(bad, 'after.json').result.pass, false);
  assert.equal(cli(['--protocol', PROTOCOL, '--out', out(), '--fault', 'nope']).status, 2);
});

test('LocalError carries a machine-readable code', () => {
  assert.equal(new LocalError('x', 'y').code, 'x');
});
