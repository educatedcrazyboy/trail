#!/usr/bin/env node
// Offline usage + repetition audit for existing Aside and Senpi session logs.
// Reads only the files it is pointed at (or that are linked by exact id), never
// calls a provider, never writes anything. Output is aggregate-only JSON:
// prompts, answers, tool arguments and read paths are reduced to hashes/counts.
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export class AuditError extends Error {}

const USAGE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'totalTokens'];
const COST_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'];
const ASIDE_ID = /\b\d{4}-\d{2}-\d{2}_[A-Za-z0-9]{16}\b/g;
const ASIDE_DIRECTORY = /^\d{4}-\d{2}-\d{2}_[A-Za-z0-9]{16}$/;
const ASIDE_BARE_ID = /^[A-Za-z0-9]{16}$/;
const TASK_ID = /^st_[0-9a-f]{8}$/;
const HELP = `Usage: node bench/audit.mjs [options]   (JSON on stdout, offline, read-only)
  --session <jsonl>        Senpi/Aside parent session log (repeatable)
  --child <jsonl>          Senpi child session log (repeatable)
  --children-root <dir>    Bounded child finder: for each task_id in a parent's task results
                           look only at <dir>/<id>/sessions/<id>/*.jsonl; absent => reported unavailable
  --benchmark-dir <dir>    Archived benchmark docs; unique Aside session ids are extracted (needs --aside-root)
  --aside-root <dir>       Aside sessions root; log is <root>/<id>/messages.jsonl
  --help
Each input is pinned to its complete-line prefix (hash + size recorded). The source may
still grow: every result is a snapshot, not final.
`;

const sha = (b) => createHash('sha256').update(b).digest('hex');
const short = (s) => sha(s).slice(0, 12);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'undefined';
}

const bump = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const obj = (m) => Object.fromEntries([...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));

function newField() { return { sum: 0, reported: 0, missing: 0, invalid: 0, max: null }; }
function emptyUsage() {
  return {
    assistant_messages: 0, usage_ok: 0, usage_missing: 0, usage_invalid: 0,
    fields: Object.fromEntries(USAGE_FIELDS.map((f) => [f, newField()])),
    cost_fields: Object.fromEntries(COST_FIELDS.map((f) => [f, newField()])),
    total_equals_input_output_cacheRead_cacheWrite: 0, total_differs_from_components: 0, total_not_checkable: 0,
    cache_basis_messages: 0, cache_read_sum: 0, prompt_side_sum: 0,
  };
}

function takeField(slot, v, where) {
  if (v === undefined || v === null) { slot.missing++; return; }
  if (!isNum(v)) { slot.invalid++; return; }
  if (v < 0) throw new AuditError(`negative usage value in ${where}`);
  slot.sum += v; slot.reported++;
  slot.max = slot.max === null ? v : Math.max(slot.max, v);
}

function addUsage(u, msg, where) {
  u.assistant_messages++;
  const usage = msg.usage;
  if (usage === undefined || usage === null) { u.usage_missing++; return; }
  if (typeof usage !== 'object' || Array.isArray(usage)) { u.usage_invalid++; return; }
  u.usage_ok++;
  for (const f of USAGE_FIELDS) takeField(u.fields[f], usage[f], `${where} usage.${f}`);
  const cost = usage.cost;
  if (cost === undefined || cost === null) for (const f of COST_FIELDS) u.cost_fields[f].missing++;
  else if (typeof cost !== 'object' || Array.isArray(cost)) for (const f of COST_FIELDS) u.cost_fields[f].invalid++;
  else for (const f of COST_FIELDS) takeField(u.cost_fields[f], cost[f], `${where} usage.cost.${f}`);
  const [i, o, cr, cw, t] = ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'].map((f) => usage[f]);
  if ([i, o, cr, cw, t].every(isNum)) {
    if (t === i + o + cr + cw) u.total_equals_input_output_cacheRead_cacheWrite++; else u.total_differs_from_components++;
    u.cache_basis_messages++; u.cache_read_sum += cr; u.prompt_side_sum += i + cr + cw;
  } else u.total_not_checkable++;
}

function finishUsage(u) {
  const fields = {};
  for (const [k, s] of Object.entries(u.fields)) fields[k] = { ...s, sum: s.reported ? s.sum : null };
  const cost = {};
  for (const [k, s] of Object.entries(u.cost_fields)) cost[k] = { ...s, sum: s.reported ? s.sum : null };
  return {
    assistant_messages: u.assistant_messages, usage_ok: u.usage_ok, usage_missing: u.usage_missing, usage_invalid: u.usage_invalid,
    tokens: fields,
    // Recorded cumulative token volume and largest single request are distinct; neither establishes billing.
    sum_totalTokens: fields.totalTokens.sum, max_totalTokens: fields.totalTokens.max,
    total_vs_components: {
      equals_input_output_cacheRead_cacheWrite: u.total_equals_input_output_cacheRead_cacheWrite,
      differs: u.total_differs_from_components, not_checkable: u.total_not_checkable,
      note: 'totalTokens is cache-inclusive when it equals input+output+cacheRead+cacheWrite; reasoning is reported separately and is not added.',
    },
    cache: {
      basis_messages: u.cache_basis_messages, cacheRead_sum: u.cache_basis_messages ? u.cache_read_sum : null,
      prompt_side_sum: u.cache_basis_messages ? u.prompt_side_sum : null,
      cacheRead_share_of_prompt_side: u.prompt_side_sum > 0 ? u.cache_read_sum / u.prompt_side_sum : null,
      definition: 'cacheRead / (input + cacheRead + cacheWrite), only over messages reporting all of the three; null when no such message.',
    },
    recorded_cost_usd: { ...cost, source: 'usage.cost.* as written in the log' },
    billing: { status: 'unknown', note: 'No provider invoice/billing data is available offline; recorded cost is the log writer\'s own estimate.' },
  };
}

function emptyRep() {
  return { tools: new Map(), calls: new Map(), reads: new Map(), callNames: new Map(), results: 0, resultErrors: 0, errorByTool: new Map(),
    resultsByTool: new Map(), orphanResults: 0, callsWithoutResult: 0, consecutive: 0, afterError: 0, assistantErrors: 0, stop: new Map() };
}

function addRep(rep, msg, state) {
  const role = msg.role;
  if (role === 'assistant') {
    bump(rep.stop, String(msg.stopReason ?? 'unspecified'));
    if (msg.stopReason === 'error' || (msg.errorMessage !== undefined && msg.errorMessage !== null)) rep.assistantErrors++;
    for (const b of Array.isArray(msg.content) ? msg.content : []) {
      if (!b || b.type !== 'toolCall' || typeof b.name !== 'string') continue;
      bump(rep.tools, b.name);
      const h = short(`${b.name}\0${canon(b.arguments ?? null)}`);
      bump(rep.calls, `${b.name}#${h}`);
      if (state.lastHash === h) rep.consecutive++;
      if (state.errored.has(h)) rep.afterError++;
      state.lastHash = h;
      if (b.id) state.pending.set(b.id, { name: b.name, h });
      const a = b.arguments;
      if (/^(read|read_file)$/i.test(b.name) && a && typeof a === 'object') {
        for (const p of [a.path, a.file_path, a.filePath, ...(Array.isArray(a.paths) ? a.paths : [])]) if (typeof p === 'string') bump(rep.reads, short(p));
      }
    }
  } else if (role === 'toolResult') {
    rep.results++;
    const p = state.pending.get(msg.toolCallId);
    const name = p?.name ?? (typeof msg.toolName === 'string' ? msg.toolName : 'unknown');
    bump(rep.resultsByTool, name);
    if (!p) rep.orphanResults++; else state.pending.delete(msg.toolCallId);
    if (msg.isError === true) { rep.resultErrors++; bump(rep.errorByTool, name); if (p) state.errored.add(p.h); }
  }
}

function finishRep(rep, state) {
  const total = [...rep.calls.values()].reduce((a, b) => a + b, 0);
  const repeats = [...rep.calls].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  const readTotal = [...rep.reads.values()].reduce((a, b) => a + b, 0);
  return {
    tool_calls: total, tool_names: obj(rep.tools),
    distinct_calls: rep.calls.size, repeated_call_excess: total - rep.calls.size,
    repeated_calls_top: repeats.slice(0, 10).map(([k, n]) => ({ tool: k.split('#')[0], args_hash: k.split('#')[1], count: n })),
    consecutive_identical_calls: rep.consecutive,
    calls_after_same_call_errored: rep.afterError,
    explicit_read_targets: { reads: readTotal, distinct: rep.reads.size, repeated_excess: readTotal - rep.reads.size,
      top: [...rep.reads].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([h, n]) => ({ path_hash: h, count: n })) },
    results: { total: rep.results, is_error_true: rep.resultErrors, by_tool: obj(rep.resultsByTool), errors_by_tool: obj(rep.errorByTool),
      orphan_results: rep.orphanResults, calls_without_result: state.pending.size },
    assistant_error_turns: rep.assistantErrors,
    stop_reasons: obj(rep.stop),
    semantics: {
      repeated_call_excess: 'tool calls minus distinct (tool name + canonical arguments) hashes; identical repeats, not necessarily wasteful.',
      consecutive_identical_calls: 'call identical to the immediately preceding call.',
      calls_after_same_call_errored: 'retry-like: identical call issued after an earlier identical call returned isError=true.',
      assistant_error_turns: 'assistant messages with stopReason=error or an errorMessage.',
    },
  };
}

function pin(file) {
  let real;
  try { real = realpathSync(file); } catch { throw new AuditError(`input not found: ${basename(file)}`); }
  const fd = openSync(real, 'r');
  let st; let buf;
  try {
    st = fstatSync(fd);
    if (!st.isFile()) throw new AuditError(`input is not a file: ${basename(file)}`);
    const bytes = Buffer.alloc(st.size);
    let offset = 0;
    while (offset < st.size) {
      const n = readSync(fd, bytes, offset, st.size - offset, offset);
      if (n === 0) break;
      offset += n;
    }
    buf = bytes.subarray(0, offset);
  } finally { closeSync(fd); }
  const cut = buf.lastIndexOf(0x0a);
  let end = cut + 1;
  const tail = buf.subarray(end);
  let tailIncluded = false;
  if (tail.length && tail.toString('utf8').trim()) {
    try { JSON.parse(tail.toString('utf8')); end = buf.length; tailIncluded = true; } catch { /* incomplete trailing line stays outside the pin */ }
  }
  const pinned = buf.subarray(0, end);
  return {
    real, dev: st.dev, ino: st.ino,
    snapshot: {
      size_bytes_at_stat: st.size, bytes_read: buf.length, pinned_bytes: pinned.length, sha256_pinned_prefix: sha(pinned),
      unpinned_tail_bytes: buf.length - pinned.length, unterminated_final_line_included: tailIncluded,
      final: false, note: 'snapshot of a complete-line prefix, read bounded by the initial descriptor stat size; the live source may have grown since.',
    },
    text: pinned.toString('utf8'),
  };
}

function parseLines(text, label) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try { out.push(JSON.parse(lines[i])); } catch { throw new AuditError(`malformed JSON in ${label} at line ${i + 1}`); }
  }
  return out;
}

function analyzeFile(pinned, label, role, seen) {
  const records = parseLines(pinned.text, label);
  const usage = emptyUsage(); const rep = emptyRep(); const state = { lastHash: null, errored: new Set(), pending: new Map() };
  const roles = new Map(); const types = new Map(); const models = new Map(); const providers = new Map(); const pm = new Map();
  const taskIds = new Map(); const ignoredUsage = new Map();
  let format = 'unknown'; let messages = 0; let dupSkipped = 0; let conflicts = 0; let compactions = 0; let tokensBefore = 0; let loopGuard = 0;
  for (const o of records) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new AuditError(`non-object record in ${label}`);
    const isWrapped = o.type === 'message' && o.message && typeof o.message === 'object';
    const isAside = !('type' in o) && typeof o.role === 'string';
    if (isWrapped) format = 'senpi'; else if (isAside && format === 'unknown') format = 'aside';
    bump(types, isWrapped ? 'message' : isAside ? 'aside:' + o.role : String(o.type ?? 'untyped'));
    if (o.type === 'compaction') { compactions++; if (isNum(o.tokensBefore)) tokensBefore += o.tokensBefore; }
    if (o.type === 'custom_message' && String(o.customType).startsWith('loop-guard')) loopGuard++;
    if (!isWrapped && !isAside) { if (o.usage !== undefined) bump(ignoredUsage, String(o.type ?? 'untyped')); continue; }
    const msg = isWrapped ? o.message : o;
    messages++; bump(roles, String(msg.role));
    const idKey = o.id ?? (msg.role === 'assistant' ? msg.responseId : undefined);
    if (idKey !== undefined) {
      const key = `${isWrapped ? 'senpi' : 'aside'}:${msg.role}:${idKey}`;
      const h = sha(canon(msg));
      const prev = seen.get(key);
      if (prev === h) { dupSkipped++; continue; }
      if (prev !== undefined) conflicts++; else seen.set(key, h);
    }
    if (msg.role === 'assistant') {
      addUsage(usage, msg, label);
      bump(models, String(msg.model ?? 'unspecified')); bump(providers, String(msg.provider ?? 'unspecified'));
      bump(pm, `${msg.provider ?? 'unspecified'}/${msg.model ?? 'unspecified'}`);
    } else if (msg.usage !== undefined) bump(ignoredUsage, `message:${msg.role}`);
    if (msg.role === 'toolResult' && msg.toolName === 'task' && msg.details && typeof msg.details.task_id === 'string') {
      bump(taskIds, msg.details.task_id);
    }
    addRep(rep, msg, state);
  }
  return {
    format, records: records.length, messages, record_types: obj(types), message_roles: obj(roles),
    duplicate_messages_skipped: dupSkipped, same_id_different_content_kept: conflicts,
    models: obj(models), providers: obj(providers), provider_models: obj(pm),
    usage: finishUsage(usage), repetition: finishRep(rep, state),
    compaction_records: { count: compactions, tokensBefore_sum: tokensBefore, counted_in_usage: false },
    loop_guard_notices: loopGuard,
    non_assistant_usage_fields_ignored: obj(ignoredUsage),
    task_ids: [...taskIds.keys()].filter((t) => TASK_ID.test(t)),
    _usage: usage, _rep: rep,
  };
}

function childIdFromPath(p) {
  const m = /\/children\/(st_[0-9a-f]{8})\//.exec(p);
  return m ? m[1] : null;
}

export function extractAsideIds(benchmarkDir, asideRoot) {
  const refs = new Map(); const files = new Map();
  const root = resolve(asideRoot);
  const directories = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && ASIDE_DIRECTORY.test(entry.name))
    .map((entry) => entry.name).sort();
  const archiveFiles = readdirSync(benchmarkDir).sort();
  let filesScanned = 0; let resultSessionReferences = 0;
  for (const name of archiveFiles) {
    const p = join(benchmarkDir, name);
    if (!statSync(p).isFile()) continue;
    filesScanned++;
    const text = readFileSync(p, 'utf8');
    const seenHere = new Set();
    if (name.endsWith('.json')) {
      let archived;
      try { archived = JSON.parse(text); }
      catch { throw new AuditError(`malformed archived JSON in ${name}`); }
      for (const row of Array.isArray(archived?.results) ? archived.results : []) {
        const id = row?.session;
        if (typeof id !== 'string' || (!ASIDE_BARE_ID.test(id) && !ASIDE_DIRECTORY.test(id))) continue;
        bump(refs, id); seenHere.add(id); resultSessionReferences++;
      }
    }
    for (const m of text.matchAll(ASIDE_ID)) {
      if (!text.slice(Math.max(0, m.index - root.length - 2), m.index).includes(root) && !text.slice(Math.max(0, m.index - 12), m.index).includes('sessions/')) continue;
      bump(refs, m[0]); seenHere.add(m[0]);
    }
    for (const id of seenHere) {
      if (!files.has(id)) files.set(id, new Set());
      files.get(id).add(name);
    }
  }
  const resolved = new Map();
  for (const [ref, references] of refs) {
    const candidates = ASIDE_BARE_ID.test(ref)
      ? directories.filter((name) => name.endsWith(`_${ref}`))
      : directories.filter((name) => name === ref);
    const resolution = candidates.length === 1 ? 'resolved' : candidates.length === 0 ? 'missing' : 'ambiguous';
    const id = resolution === 'resolved' ? candidates[0] : ref;
    if (!resolved.has(id)) resolved.set(id, { id, references: 0, sources: new Set(), resolution, candidates });
    const entry = resolved.get(id);
    entry.references += references;
    for (const name of files.get(ref)) entry.sources.add(name);
  }
  return {
    files_scanned: filesScanned, result_session_references: resultSessionReferences,
    ids: [...resolved.values()].sort((a, b) => a.id.localeCompare(b.id))
      .map(({ sources, ...entry }) => ({ ...entry, files: sources.size })),
  };
}

export function audit(opts) {
  const inputs = []; // {path, role}
  for (const p of opts.sessions ?? []) inputs.push({ path: p, role: 'parent' });
  for (const p of opts.children ?? []) inputs.push({ path: p, role: 'child' });
  const asideRefs = opts.benchmarkDir ? (opts.asideRoot ? extractAsideIds(opts.benchmarkDir, opts.asideRoot) : (() => { throw new AuditError('--benchmark-dir requires --aside-root'); })()) : null;
  const asideMissing = []; const asideAmbiguous = [];
  if (asideRefs) {
    for (const r of asideRefs.ids) {
      if (r.resolution === 'ambiguous') { asideAmbiguous.push({ id: r.id, candidates: r.candidates }); continue; }
      if (r.resolution === 'missing') { asideMissing.push(r.id); continue; }
      const f = join(resolve(opts.asideRoot), r.id, 'messages.jsonl');
      try { statSync(f); inputs.push({ path: f, role: 'aside', asideId: r.id }); } catch { asideMissing.push(r.id); }
    }
  }
  const linkage = { parents: [], unavailable_children: [], unlinked_children: [], child_finder: opts.childrenRoot ? 'bounded: <root>/<task_id>/sessions/<task_id>/*.jsonl only' : 'disabled (no --children-root)' };
  const seen = new Map(); const byReal = new Map(); const byIno = new Map(); const byHash = new Map();
  const results = []; const pending = [...inputs]; let autoChildren = [];
  const run = (inp) => {
    const pinned = pin(inp.path);
    const label = inp.asideId ?? basename(inp.path).replace(/\.jsonl$/, '');
    const entry = { label, role: inp.role, source: inp.asideId ? 'aside-archived-ref' : (inp.auto ? 'auto-linked' : 'explicit'), snapshot: pinned.snapshot };
    const dupOf = byReal.get(pinned.real) ?? byIno.get(`${pinned.dev}:${pinned.ino}`) ?? byHash.get(pinned.snapshot.sha256_pinned_prefix);
    if (dupOf) { entry.duplicate_input_of = dupOf; entry.counted = false; entry.duplicate_reason = byReal.has(pinned.real) ? 'same real path' : byIno.has(`${pinned.dev}:${pinned.ino}`) ? 'hardlink (same dev/inode)' : 'identical content hash'; results.push({ entry }); return; }
    byReal.set(pinned.real, label); byIno.set(`${pinned.dev}:${pinned.ino}`, label); byHash.set(pinned.snapshot.sha256_pinned_prefix, label);
    const a = analyzeFile(pinned, label, inp.role, seen);
    const childId = inp.role === 'child' ? childIdFromPath(pinned.real) : null;
    Object.assign(entry, { counted: true, child_task_id: childId, ...a });
    results.push({ entry, a });
  };
  while (pending.length) {
    const inp = pending.shift();
    run(inp);
  }
  // Linkage: parent task ids vs provided/discovered children.
  const provided = new Map(results.filter((r) => r.a && r.entry.child_task_id).map((r) => [r.entry.child_task_id, r.entry.label]));
  for (const r of results.filter((x) => x.a && x.entry.role === 'parent')) {
    const ids = r.a.task_ids;
    const rec = { parent: r.entry.label, task_ids: ids, linked: [], unavailable: [] };
    for (const id of ids) {
      if (provided.has(id)) { rec.linked.push({ task_id: id, child: provided.get(id), via: 'explicit' }); continue; }
      if (opts.childrenRoot) {
        const dir = join(resolve(opts.childrenRoot), id, 'sessions', id);
        let found = [];
        try { found = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort(); } catch { /* unavailable */ }
        if (found.length) {
          for (const f of found) { run({ path: join(dir, f), role: 'child', auto: true }); }
          const last = results[results.length - 1];
          provided.set(id, last.entry.label); rec.linked.push({ task_id: id, child: last.entry.label, files: found.length, via: 'children-root' });
          continue;
        }
      }
      rec.unavailable.push(id); linkage.unavailable_children.push({ parent: r.entry.label, task_id: id });
    }
    linkage.parents.push(rec);
  }
  const allParentIds = new Set(results.filter((x) => x.a && x.entry.role === 'parent').flatMap((x) => x.a.task_ids));
  for (const [id, label] of provided) if (!allParentIds.has(id)) linkage.unlinked_children.push({ task_id: id, child: label });
  for (const r of results.filter((x) => x.a && x.entry.role === 'child' && !x.entry.child_task_id)) linkage.unlinked_children.push({ task_id: null, child: r.entry.label, reason: 'child path has no /children/<task_id>/ segment' });

  // Aggregates over counted unique inputs only, grouped by role; no parent-summary double counting
  // because usage is read exclusively from assistant messages, never from task/task_output results or compaction summaries.
  const groups = {};
  const roleKey = (e) => (e.role === 'aside' ? 'aside' : `senpi_${e.role}`);
  const counted = results.filter((r) => r.a);
  const mk = () => ({ inputs: 0, messages: 0, u: emptyUsage(), rep: emptyRep(), st: { pending: new Map() } });
  const sum = (g, a) => {
    g.inputs++; g.messages += a.messages;
    for (const k of ['assistant_messages', 'usage_ok', 'usage_missing', 'usage_invalid', 'total_equals_input_output_cacheRead_cacheWrite', 'total_differs_from_components', 'total_not_checkable', 'cache_basis_messages', 'cache_read_sum', 'prompt_side_sum']) g.u[k] += a._usage[k];
    for (const [fk, set] of [['fields', USAGE_FIELDS], ['cost_fields', COST_FIELDS]]) for (const f of set) {
      const d = g.u[fk][f]; const s = a._usage[fk][f];
      d.sum += s.sum; d.reported += s.reported; d.missing += s.missing; d.invalid += s.invalid;
      if (s.max !== null) d.max = d.max === null ? s.max : Math.max(d.max, s.max);
    }
    const r = g.rep, x = a._rep;
    for (const k of ['results', 'resultErrors', 'orphanResults', 'consecutive', 'afterError', 'assistantErrors']) r[k] += x[k];
    for (const k of ['tools', 'calls', 'reads', 'errorByTool', 'resultsByTool', 'stop']) for (const [n, c] of x[k]) bump(r[k], n, c);
    g.callsWithoutResult = (g.callsWithoutResult ?? 0) + a.repetition.results.calls_without_result;
  };
  for (const { entry, a } of counted) {
    const k = roleKey(entry); groups[k] ??= mk(); sum(groups[k], a);
    groups.all_unique ??= mk(); sum(groups.all_unique, a);
  }
  const aggregates = {};
  for (const [k, g] of Object.entries(groups)) {
    const rep = finishRep(g.rep, { pending: new Map() }); rep.results.calls_without_result = g.callsWithoutResult ?? 0;
    aggregates[k] = { inputs: g.inputs, messages: g.messages, usage: finishUsage(g.u), repetition: rep };
  }
  const clean = results.map(({ entry }) => { const e = { ...entry }; delete e._usage; delete e._rep; return e; });
  return {
    tool: 'trail bench/audit.mjs', schema: 1, offline: true, provider_calls: 0,
    snapshot_policy: 'each input pinned to its complete-line prefix with sha256; sources may grow; not final.',
    inputs: clean,
    duplicate_inputs_excluded: clean.filter((e) => e.counted === false).length,
    aside_references: asideRefs ? {
      files_scanned: asideRefs.files_scanned, result_session_references: asideRefs.result_session_references,
      unique_ids: asideRefs.ids.length, ids: asideRefs.ids, missing_logs: asideMissing, ambiguous_sessions: asideAmbiguous,
    } : null,
    linkage,
    aggregates,
    aggregation_note: 'senpi_parent, senpi_child and aside are separate; all_unique is their union of counted unique inputs. Parent task/task_output summaries and compaction records are never summed as usage.',
  };
}

export function parseArgs(argv) {
  const o = { sessions: [], children: [] };
  const need = (i, f) => { if (i + 1 >= argv.length) throw new AuditError(`${f} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--session') o.sessions.push(need(i++, a));
    else if (a === '--child') o.children.push(need(i++, a));
    else if (a === '--benchmark-dir') o.benchmarkDir = need(i++, a);
    else if (a === '--aside-root') o.asideRoot = need(i++, a);
    else if (a === '--children-root') o.childrenRoot = need(i++, a);
    else throw new AuditError(`unknown argument: ${a}`);
  }
  return o;
}

export function main(argv, out = process.stdout, err = process.stderr) {
  try {
    const o = parseArgs(argv);
    if (o.help) { out.write(HELP); return 0; }
    if (!o.sessions.length && !o.children.length && !o.benchmarkDir) throw new AuditError('no inputs; see --help');
    out.write(JSON.stringify(audit(o), null, 2) + '\n');
    return 0;
  } catch (e) {
    if (!(e instanceof AuditError)) throw e;
    err.write(`audit: ${e.message}\n`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2));
