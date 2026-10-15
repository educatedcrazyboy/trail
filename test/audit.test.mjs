import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { audit, AuditError } from '../bench/audit.mjs';

const CLI = fileURLToPath(new URL('../bench/audit.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'audit-test-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const asst = (id, usage, content = [], extra = {}) => ({ type: 'message', id, message: { role: 'assistant', provider: 'p', model: 'm', content, usage, stopReason: 'stop', ...extra } });
const call = (id, name, args) => ({ type: 'toolCall', id, name, arguments: args });
const res = (id, toolCallId, toolName, isError = false) => ({ type: 'message', id, message: { role: 'toolResult', toolCallId, toolName, isError, content: [] } });
const U = (input, output, cacheRead, cacheWrite, extra = {}) => ({ input, output, cacheRead, cacheWrite, reasoning: 1, totalTokens: input + output + cacheRead + cacheWrite, cost: { total: 0.5 }, ...extra });
const file = (name, rows) => { const p = join(dir, name); writeFileSync(p, typeof rows === 'string' ? rows : jl(rows)); return p; };

test('cache-inclusive totals: sum and max are distinct, fields separate, cache share', () => {
  const p = file('cache.jsonl', [asst('a1', U(100, 10, 900, 0)), asst('a2', U(50, 5, 450, 50))]);
  const a = audit({ sessions: [p] }).aggregates.senpi_parent.usage;
  assert.equal(a.sum_totalTokens, 1010 + 555);
  assert.equal(a.max_totalTokens, 1010);
  assert.equal(a.tokens.input.sum, 150); assert.equal(a.tokens.cacheRead.sum, 1350); assert.equal(a.tokens.cacheWrite.sum, 50);
  assert.equal(a.tokens.reasoning.sum, 2);
  assert.equal(a.total_vs_components.equals_input_output_cacheRead_cacheWrite, 2);
  assert.equal(a.cache.cacheRead_share_of_prompt_side, 1350 / (150 + 1350 + 50));
  assert.equal(a.recorded_cost_usd.total.sum, 1);
  assert.equal(a.billing.status, 'unknown');
});

test('missing/invalid usage is explicit and never zero-filled', () => {
  const p = file('missing.jsonl', [asst('a1', undefined), asst('a2', 'oops'), asst('a3', { input: 5, totalTokens: 'x' })]);
  const a = audit({ sessions: [p] }).aggregates.senpi_parent.usage;
  assert.equal(a.usage_missing, 1); assert.equal(a.usage_invalid, 1); assert.equal(a.usage_ok, 1);
  assert.equal(a.tokens.input.sum, 5); assert.equal(a.tokens.output.sum, null); assert.equal(a.tokens.output.missing, 1);
  assert.equal(a.tokens.totalTokens.invalid, 1); assert.equal(a.sum_totalTokens, null); assert.equal(a.max_totalTokens, null);
  assert.equal(a.total_vs_components.not_checkable, 1);
});

test('malformed JSON and negative usage are rejected', () => {
  assert.throws(() => audit({ sessions: [file('bad.jsonl', '{"type":"message"}\n{nope}\n')] }), AuditError);
  assert.throws(() => audit({ sessions: [file('neg.jsonl', [asst('a1', U(1, 1, 1, 1, { output: -1 }))])] }), /negative/);
  assert.throws(() => audit({ sessions: [file('negcost.jsonl', [asst('a1', U(1, 1, 1, 1, { cost: { total: -0.1 } }))])] }), /negative/);
});

test('duplicate inputs (same path, hardlink, copy) and identical message ids are counted once', () => {
  const p = file('dup.jsonl', [asst('x1', U(10, 1, 0, 0)), asst('x1', U(10, 1, 0, 0)), asst('x2', U(20, 2, 0, 0))]);
  const hl = join(dir, 'dup-hardlink.jsonl'); linkSync(p, hl);
  const cp = join(dir, 'dup-copy.jsonl'); copyFileSync(p, cp);
  const r = audit({ sessions: [p, p, hl], children: [cp] });
  assert.equal(r.duplicate_inputs_excluded, 3);
  assert.deepEqual(r.inputs.filter((i) => !i.counted).map((i) => i.duplicate_reason).sort(), ['hardlink (same dev/inode)', 'identical content hash', 'same real path'].sort());
  const u = r.aggregates.all_unique.usage;
  assert.equal(u.assistant_messages, 2); assert.equal(u.tokens.input.sum, 30);
  assert.equal(r.inputs[0].duplicate_messages_skipped, 1);
});

test('same message id with different content is kept and flagged, not merged', () => {
  const p = file('conflict.jsonl', [asst('k', U(1, 1, 0, 0)), asst('k', U(2, 2, 0, 0))]);
  const e = audit({ sessions: [p] }).inputs[0];
  assert.equal(e.same_id_different_content_kept, 1); assert.equal(e.usage.assistant_messages, 2);
});

test('snapshot pins complete-line prefix and flags it as not final', () => {
  const p = file('grow.jsonl', jl([asst('a1', U(1, 1, 0, 0))]) + '{"type":"message","id":"a2","mess');
  const s = audit({ sessions: [p] }).inputs[0].snapshot;
  assert.equal(s.final, false); assert.ok(s.unpinned_tail_bytes > 0); assert.equal(s.pinned_bytes + s.unpinned_tail_bytes, s.size_bytes_at_stat);
  assert.match(s.sha256_pinned_prefix, /^[0-9a-f]{64}$/);
});

test('repetition: hashed repeated calls, read targets, errors, retry-like; no raw values leak', () => {
  const secret = '/very/secret/path.txt';
  const p = file('rep.jsonl', [
    asst('a1', U(1, 1, 0, 0), [call('c1', 'read', { path: secret }), call('c2', 'bash_output', { id: 'zzz-secret' })]),
    res('r1', 'c1', 'read', true), res('r2', 'c2', 'bash_output'),
    asst('a2', U(1, 1, 0, 0), [call('c3', 'read', { path: secret }), call('c4', 'bash_output', { id: 'zzz-secret' })]),
    res('r3', 'c3', 'read'), res('r4', 'c4', 'bash_output'),
    asst('a3', U(1, 1, 0, 0), [call('c5', 'read_file', { path: secret })]),
    res('r5', 'c5', 'read_file'),
  ]);
  const r = audit({ sessions: [p] }); const rep = r.aggregates.senpi_parent.repetition;
  assert.deepEqual(rep.tool_names, { bash_output: 2, read: 2, read_file: 1 });
  assert.equal(rep.distinct_calls, 3); assert.equal(rep.repeated_call_excess, 2);
  assert.equal(rep.explicit_read_targets.reads, 3); assert.equal(rep.explicit_read_targets.distinct, 1);
  assert.equal(rep.calls_after_same_call_errored, 1); assert.equal(rep.results.is_error_true, 1);
  assert.equal(rep.results.errors_by_tool.read, 1);
  const out = JSON.stringify(r);
  assert.ok(!out.includes('secret'));
});

test('parent/child linkage via bounded finder; unavailable children reported; Aside refs unique', () => {
  const croot = join(dir, 'children'); mkdirSync(join(croot, 'st_aaaaaaaa', 'sessions', 'st_aaaaaaaa'), { recursive: true });
  writeFileSync(join(croot, 'st_aaaaaaaa', 'sessions', 'st_aaaaaaaa', 'c.jsonl'), jl([asst('c1', U(7, 1, 0, 0))]));
  const taskRes = (id, tid) => ({ type: 'message', id, message: { role: 'toolResult', toolCallId: id, toolName: 'task', isError: false, content: [], details: { task_id: tid } } });
  const p = file('parent.jsonl', [asst('p1', U(3, 1, 0, 0)), taskRes('t1', 'st_aaaaaaaa'), taskRes('t2', 'st_bbbbbbbb')]);
  const r = audit({ sessions: [p], childrenRoot: croot });
  assert.equal(r.linkage.parents[0].linked[0].task_id, 'st_aaaaaaaa');
  assert.deepEqual(r.linkage.unavailable_children.map((x) => x.task_id), ['st_bbbbbbbb']);
  assert.equal(r.aggregates.senpi_parent.usage.tokens.input.sum, 3);
  assert.equal(r.aggregates.senpi_child.usage.tokens.input.sum, 7);
  assert.equal(r.aggregates.all_unique.usage.tokens.input.sum, 10);

  const aroot = join(dir, 'aside'); const bdir = join(dir, 'bench');
  mkdirSync(join(aroot, '2026-10-10_AAAAAAAAAAAAAAAA'), { recursive: true }); mkdirSync(bdir);
  writeFileSync(join(aroot, '2026-10-10_AAAAAAAAAAAAAAAA', 'messages.jsonl'), jl([{ role: 'assistant', provider: 'p', model: 'm', content: [], usage: U(4, 1, 0, 0), responseId: 'g1' }]));
  writeFileSync(join(bdir, 'a.json'), JSON.stringify({ tail: `x ${aroot}/2026-10-10_AAAAAAAAAAAAAAAA/tmp/i.jpg ${aroot}/2026-10-10_AAAAAAAAAAAAAAAA/tmp/j.jpg and ${aroot}/2026-10-11_BBBBBBBBBBBBBBBB/x` }));
  const a = audit({ benchmarkDir: bdir, asideRoot: aroot });
  assert.equal(a.aside_references.unique_ids, 2); assert.deepEqual(a.aside_references.missing_logs, ['2026-10-11_BBBBBBBBBBBBBBBB']);
  assert.equal(a.aside_references.ids[0].references, 2);
  assert.equal(a.aggregates.aside.usage.tokens.input.sum, 4);
});

test('CLI: --help exits 0, bad input exits 2, good input emits JSON', () => {
  const run = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });
  assert.equal(run('--help').status, 0);
  assert.equal(run('--session', file('bad2.jsonl', 'not json\n')).status, 2);
  const ok = run('--session', file('ok.jsonl', [asst('a1', U(1, 1, 0, 0))]));
  assert.equal(ok.status, 0); assert.equal(JSON.parse(ok.stdout).provider_calls, 0);
});

test('archived results[].session bare IDs resolve once alongside dated screenshot references', () => {
  const aroot = join(dir, 'bare-aside'); const bdir = join(dir, 'bare-bench');
  const id = 'Aikbo9UhD0ynJTHo'; const dated = `2026-10-13_${id}`;
  mkdirSync(join(aroot, dated), { recursive: true }); mkdirSync(bdir);
  writeFileSync(join(aroot, dated, 'messages.jsonl'), jl([
    { role: 'assistant', provider: 'p', model: 'm', responseId: 'bare-response', content: [], usage: U(17, 3, 80, 0) },
  ]));
  writeFileSync(join(bdir, 'results.json'), JSON.stringify({
    results: [{ session: id }, { session: id }],
    unrelated: 'BBBBBBBBBBBBBBBB',
  }));
  writeFileSync(join(bdir, 'screenshot.md'), `${aroot}/${dated}/tmp/image.jpeg`);
  const r = audit({ benchmarkDir: bdir, asideRoot: aroot });
  assert.equal(r.aside_references.ids[0].references, 3, 'bare result fields must not be omitted');
  assert.equal(r.aside_references.ids[0].files, 2);
  assert.equal(r.aside_references.unique_ids, 1, 'bare and dated forms identify one session');
  assert.equal(r.aside_references.ids[0].id, dated);
  assert.equal(r.aside_references.ids[0].resolution, 'resolved');
  assert.equal(r.aside_references.result_session_references, 2);
  assert.equal(r.aggregates.aside.inputs, 1);
  assert.equal(r.aggregates.aside.usage.tokens.input.sum, 17);
  assert.equal(r.aggregates.aside.usage.sum_totalTokens, 100);
});

test('bare session lookup reports missing and ambiguous directories without guessing or reading candidates', () => {
  const aroot = join(dir, 'unresolved-aside'); const bdir = join(dir, 'unresolved-bench');
  const ambiguous = 'AAAAAAAAAAAAAAAA'; const missing = 'MMMMMMMMMMMMMMMM';
  const candidates = [`2026-10-10_${ambiguous}`, `2026-10-11_${ambiguous}`];
  mkdirSync(aroot); mkdirSync(bdir);
  // Invalid logs deliberately prove that ambiguous or suffix-lookalike directories are never read.
  for (const name of [...candidates, `2026-10-10_prefix${missing}`]) {
    mkdirSync(join(aroot, name));
    writeFileSync(join(aroot, name, 'messages.jsonl'), 'not json\n');
  }
  writeFileSync(join(bdir, 'results.json'), JSON.stringify({ results: [{ session: ambiguous }, { session: missing }] }));
  const r = audit({ benchmarkDir: bdir, asideRoot: aroot });
  assert.deepEqual(r.aside_references.missing_logs, [missing]);
  assert.deepEqual(r.aside_references.ambiguous_sessions, [{ id: ambiguous, candidates }]);
  assert.equal(r.aside_references.unique_ids, 2);
  assert.equal(r.inputs.length, 0);
  assert.equal(r.aggregates.aside, undefined, 'unavailable sessions must not turn into zero-valued usage');
});

test('pin excludes bytes appended immediately after the initial size snapshot', (t) => {
  const initial = jl([asst('snapshot-before', U(1, 1, 0, 0))]);
  const appended = jl([asst('snapshot-after', U(90, 10, 0, 0))]);
  const p = file('append-at-stat.jsonl', initial);
  const real = fs.realpathSync(p);
  const originalStat = fs.statSync; const originalFstat = fs.fstatSync;
  let didAppend = false;
  const appendAfterStat = (st) => {
    if (!didAppend) { fs.appendFileSync(p, appended); didAppend = true; }
    return st;
  };
  t.mock.method(fs, 'statSync', (target, ...args) => {
    const st = originalStat(target, ...args);
    return target === real ? appendAfterStat(st) : st;
  });
  t.mock.method(fs, 'fstatSync', (...args) => appendAfterStat(originalFstat(...args)));
  syncBuiltinESMExports();
  let r;
  try { r = audit({ sessions: [p] }); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(didAppend, true, 'the append must happen after the initial stat, not by timing luck');
  const snapshot = r.inputs[0].snapshot;
  assert.equal(snapshot.size_bytes_at_stat, Buffer.byteLength(initial));
  assert.equal(snapshot.pinned_bytes, Buffer.byteLength(initial));
  assert.equal(snapshot.sha256_pinned_prefix, createHash('sha256').update(initial).digest('hex'));
  assert.equal(r.aggregates.senpi_parent.usage.assistant_messages, 1);
  assert.equal(fs.statSync(p).size, Buffer.byteLength(initial + appended));
});
