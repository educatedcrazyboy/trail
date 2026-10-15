# G005 independent falsification: FAIL

Date: 2026-10-15. Worktree: `/tmp/trail-controls.dbpf1i/worktree`.
Auditor used Node v26.5.0 and an independently created temporary root.

**Overall FAIL:** incomplete logged identity can be reported as verified.
Preparation, containment, treatment equality, schedule balance, and the live
refusal passed the local checks below. The requested regression suite passed
43/43, but does not catch the demonstrated partial-identity cases.
No implementation/test changes, commits, provider calls, or browser calls
were made by this auditor. This report is the only repository file written.

**Local preparation is not runtime isolation.** Neither these passing checks
nor the model metadata comparison establish browser/account-memory isolation,
absence of automatic injection, actual provider routing, or reasoning effort.
The live gate must remain blocked.

## Finding: missing identity fields can produce verified success

Severity: high for the stated provenance contract; not a live-gate bypass.
Locations: `bench/measure.mjs:126-154`, `bench/bench.mjs:84-90`.

`checkProvenanceExpectation` checks a missing model only when an expected
model was supplied, and a missing provider only when an expected provider
was supplied. It can therefore return `satisfied: true` while
`provenance.flags.missing` is true. The CLI directly maps this to
`provenance.verified: true` and exits 0.

Two independent real CLI executions reproduced this:

| Logged assistant identity | CLI expectation | Actual exit | Actual report |
| --- | --- | --- | --- |
| model `z-ai/glm-5.3-flash-ultrafast`, provider absent | `--expected-model z-ai/glm-5.3-flash-ultrafast` | 0 | `missing: true`, `consistent: false`, `verified: true` |
| provider `opengateway`, model absent | `--expected-provider opengateway` | 0 | `missing: true`, `consistent: false`, `verified: true` |

Both should reject with exit 2 under `.omo/g005-models.md`'s stated rule that
missing metadata is unknown, not success, and that an expectation with missing
metadata is rejected. If field-specific partial verification is intended
instead, that is a narrower contract than the report claims, and a generic
`verified: true` must not be treated as a complete provider/model identity
verification. This audit did not change either contract or implementation.

Minimal fixture shapes used, each as one line of its own `messages.jsonl`:

```json
{"role":"assistant","content":[{"type":"text","text":"shipment"}],"stopReason":"stop","model":"z-ai/glm-5.3-flash-ultrafast"}
{"role":"assistant","content":[{"type":"text","text":"shipment"}],"stopReason":"stop","provider":"opengateway"}
```

These are two separate sessions, not two lines in one session. The task was
`{"doneCheck":["shipment"]}`. The exact commands were the `M` commands below
against `sessions/missing-provider/messages.jsonl` and
`sessions/missing-model/messages.jsonl`, respectively. Expected exit was 2;
actual exit was 0 with empty stderr in both cases.

## Read scope and report gate

Both required reports existed and were read in full:
`.omo/g005-prepare.md` and `.omo/g005-models.md`. No missing-report blocker.
All changed source/tests were read:

- `bench/prepare.mjs`
- `bench/measure.mjs`
- `bench/bench.mjs`
- `test/prepare.test.mjs`
- `test/bench.test.mjs`

Core extraction and write-boundary code was also inspected:
`extractSession`, `saveConfig`, `distillFlows`, `emitSkill`, and
`syncAsideMemory` in `src/core.mjs`. Preparation passes explicit owned home
and account paths, disables automatic emission during distillation, and never
calls the prompt-persisting ingestion API. The live path rejects before task
file access or any execution path.

## Execution environment and command notation

All 35 independent CLI invocations used `execFile` with argv arrays, not shell
interpolation, in the worktree. Commands below use shell notation for the same
argv. Every invocation inherited the following overrides:

```sh
W=/tmp/trail-controls.dbpf1i/worktree
R=/private/var/folders/m6/xsqcdfwn7618yqjqh1np5q200000gn/T/trail-g005-independent-JG7STL
HOME="$R/home"
XDG_CACHE_HOME="$R/cache"
TRAIL_HOME="$R/home/forbidden"
TMPDIR="$R"
cd "$W"
```

These environment values were passed explicitly to each subprocess. The
original user home/profile was not used as an output or mutation target.
`$R` was made with `fs.mkdtemp`; its home/cache directories were made before
the calls. The simulated home contained only an auditor-created sentinel.

Command abbreviations used in the tables:

```sh
# P(INPUT, OUTPUT)
node bench/prepare.mjs prepare --training-session INPUT \
  --model fixture/local-model --effort high --out OUTPUT
# V(DIRECTORY)
node bench/prepare.mjs verify DIRECTORY
# M(SESSION, extra arguments)
node bench/bench.mjs --measure-session SESSION \
  --task "$R/model-task.json" [extra arguments]
```

`INPUT` for normal preparation was the absolute path
`$W/test/fixtures/run1.messages.jsonl`. Synthetic mutation/model fixtures and
all copied bundles existed only under `$R`. They were generated using Node
filesystem APIs as test artifacts, not added to the repository.

## Preparation CLI: observed outcomes

Each mutation bundle started as a separate filesystem copy of `$R/clean`.
All failure outputs retained `runtimeIsolation: "unverified"` and
`liveAllowed: false`.

| Command / independently applied mutation | Exit | Evidence / adjudication |
| --- | --- | --- |
| `P(fixture, "$R/clean")` | 0 | PASS, 18 arms, cleanup receipt |
| `V("$R/clean")` | 0 | PASS, same frozen hash, zero temporary roots |
| `V("$R/dirty")`; append to one on-arm `memory/MEMORY.md` | 2 | `arm differs from frozen treatment/baseline` |
| `V("$R/extra")`; add root `settings.json` | 2 | `unexpected or missing preparation files` |
| `V("$R/symlink")`; replace on-arm memory file with link to owned sentinel | 2 | `symlink in inventory` |
| `V("$R/hardlink")`; replace same file with hardlink to owned sentinel | 2 | `only unlinked regular files are allowed` |
| `V("$R/extra-directory")`; add empty directory | 2 | `unexpected or missing preparation files` |
| `V("$R/deleted")`; remove on-arm memory file | 2 | `arm differs from frozen treatment/baseline` |
| `V("$R/forged-arm")`; append content and update matching arm's declared bytes/hash | 2 | `manifest does not match frozen artifacts, schedule or baseline` |
| `V("$R/whitelist-user-file")`; put `settings.json` in frozen tree, add to declared allowlist/inventory, recompute declared frozen hash | 2 | `invalid frozen treatment topology` |
| `V("$R/forged-cold")`; put `MEMORY.md` in cold account and declare its inventory/hash | 2 | `manifest does not match frozen artifacts, schedule or baseline` |
| `V("$R/manifest-traversal")`; arm directory becomes `../../home` | 2 | `manifest does not match frozen artifacts, schedule or baseline` |
| `V("$R/manifest-live")`; set liveAllowed true and runtimeIsolation verified | 2 | Same manifest mismatch |
| `V("$R/manifest-extra")`; add `userFileAllowlist` field | 2 | Same manifest mismatch |
| `V("$R/frozen-dirty")`; append frozen memory content, leave declared hash unchanged | 2 | Same manifest mismatch |
| `P(fixture, "$R/clean")` again | 2 | EEXIST; complete clean inventory unchanged |
| `P(fixture, "$R/existing-empty")` | 2 | EEXIST; existing directory stays empty |
| `P(fixture, "$R/linked-parent/escaped")`; linked-parent points to owned home | 2 | `symlink path component refused`; escaped output absent |
| `P(fixture, "$R/existing-empty/../traversal-out")` | 2 | `path traversal refused`; output absent |
| `P("$R/linked-training.jsonl", "$R/linked-input-out")`; input symlink to fixture | 2 | `symlink path component refused`; output absent |
| `P("$R/thin-training.jsonl", "$R/thin-failed-output")` | 2 | `training produced no reusable treatment; cleanup: owned output removed, no cache created` |
| `P("$R/bad-training.jsonl", "$R/bad-failed-output")`; malformed `{` | 2 | JSON parse rejection; output absent |

The thin fixture had one recorded `openTab('http://localhost/')`/snapshot
interaction, a corresponding root-page tool result, and terminal assistant
text with `stopReason: "stop"`. It reaches distillation after exclusive output
creation, so its ENOENT check exercises cleanup after creation, not only
prevalidation failure.

**Manifest whitelist adjudication: PASS for the stated local topology
contract.** Allowed paths are derived from validated hosts rather than
accepted from arbitrary manifest allowlist entries. Adding an arbitrary user
settings file and corresponding manifest declarations did not legitimize it.
Forged arm inventories and a forged nonempty cold baseline also failed.
Hashes are not signatures: replacing all allowed frozen bytes, all on copies,
and every matching hash is outside the reported trust model. This audit does
not claim content authenticity against complete coherent bundle replacement.

## Independent artifact assertions

Assertions ran in the resident Node kernel and all completed without throwing.
They enumerated real trees, hashed file bytes, compared inventories, checked
unique inodes, and read canary strings; they did not merely trust the manifest.

- Training: 3,600 bytes; SHA-256
  `da43df24b8db5035ea9fdba7139161d6dd4870d63fe9aaadae070e8426d31324`.
  Actual input hash stayed unchanged through the audit.
- Frozen manifest inventory hash:
  `a7e0e07ec3ad96a4125bd7de10a956fe456283dc6d18224d3af5f129de75279f`.
  Different preparations can legitimately differ because core emission adds
  timestamps and a generated marker.
- Host: `127.0.0.1:8769`. Exactly four frozen files:
  `memory/MEMORY.md` (316 bytes),
  `memory/sites/trail-127-0-0-1-8769.md` (333 bytes),
  `skills/user/trail-127-0-0-1-8769/SKILL.md` (850 bytes),
  `skills/user/trail-127-0-0-1-8769/references/memory.md` (1,415 bytes).
- All six on accounts matched the frozen files byte-for-byte. All twelve
  cold/off accounts had empty enumerated trees, hence identical contents.
  The 24 arm files had 24 distinct inodes and link count 1.
- Six unique orders. Each of cold/on/off appeared in positions 1, 2, and 3
  exactly twice. Each of the six distinct ordered adjacent condition pairs
  occurred exactly twice.
- Entire clean bundle: 29 files, comprising manifest plus four frozen and
  24 on-arm files. No `.jsonl`, `state.json`, `memory.json`, or `.work` tree.
  Every output file was scanned: fixture fill value `FIRST-RUN`, page label
  `XXPROBE`, the fixture's final-response phrase, field label, `turnId`,
  `call_1`, `locator(`, and absolute training path were absent.
- The clean inventory and frozen byte inventory remained unchanged after
  tests against the separate mutation copies.

**Immutable treatment adjudication: PASS as a finalized shared snapshot
comparison, not OS-enforced immutability.** All on replicas match one snapshot,
not independently redistilled treatments. Files remain writable; verification
detects the tested mutations at check time, not concurrent hostile writes.

## Model CLI and live gate

The synthetic exact session recorded two assistant responses at messages 1
and 3, both with model `z-ai/glm-5.3-flash-ultrafast` and provider
`opengateway`; the first included a logged tool call. No logged code was
executed. The mixed fixture differed only in an earlier assistant's model,
demonstrating that final-message-only checking was not used.

| Command | Exit | Actual result |
| --- | --- | --- |
| `M("$R/sessions/exact/messages.jsonl")` | 0 | Two observations; consistent true; verified null |
| Same plus `--expected-model z-ai/glm-5.3-flash-ultrafast --expected-provider opengateway` | 0 | verified true |
| Same plus `--expected-model openrouter/meta/muse-spark-1.3-contributor` | 2 | verified false; mismatches identify messages 1 and 3 |
| Same plus `--expected-model muse` | 2 | Alias does not match logged model |
| Same plus `--expected-provider wrong` | 2 | Provider mismatch |
| `M("$R/sessions/missing-provider/messages.jsonl", --expected-model z-ai/glm-5.3-flash-ultrafast)` | **0** | **FAIL: missing true yet verified true** |
| `M("$R/sessions/missing-model/messages.jsonl", --expected-provider opengateway)` | **0** | **FAIL: missing true yet verified true** |
| `M("$R/sessions/no-model/messages.jsonl", --expected-model z-ai/glm-5.3-flash-ultrafast)` | 2 | Requested model metadata missing; verified false |
| `M("$R/sessions/no-assistant/messages.jsonl", --expected-model z-ai/glm-5.3-flash-ultrafast)` | 2 | No assistant messages; verified false |
| `M("$R/sessions/mixed-intermediate/messages.jsonl", --expected-model z-ai/glm-5.3-flash-ultrafast)` | 2 | Earlier message 1 mismatch; mixed true |
| `node bench/bench.mjs "$R/nonexistent-task.json" --model fixture/local-model` | 2 | FAIRNESS-FIRST before nonexistent task file access |
| `node bench/bench.mjs "$R/nonexistent-task.json" --rotate` | 2 | Rotation/learning provenance refusal |
| `M("$R/sessions/exact/messages.jsonl", -m z-ai/glm-5.3-flash-ultrafast)` | 2 | Read-only measurement cannot use live options |

Mismatch cases emitted both the JSON report on stdout and diagnostic problems
on stderr. Exact identity matching and intermediate-message coverage passed.
The partial-metadata rule failed as detailed above. These are real CLI tests
against synthetic logs, not a re-audit of the personal historical session in
the model report, and not evidence that any model actually ran now.

## Required regression and syntax checks

Executed once, with the same owned home/cache/TMPDIR overrides:

```sh
node --test test/core.test.mjs test/e2e.test.mjs test/bench.test.mjs test/prepare.test.mjs
node --check bench/prepare.mjs
node --check bench/bench.mjs
node --check bench/measure.mjs
node --check test/prepare.test.mjs
node --check test/bench.test.mjs
git diff --check
```

The commands were chained with `&&`; completion sentinel
`G005_REQUIRED_CHECKS_PASS` was observed and monitor exit was **0**.
Test result: **43 tests, 43 pass, 0 fail**, duration 944.380125 ms.
Each syntax check and diff check therefore exited 0.
No tests were changed, weakened, skipped, or rerun to obtain this result.
No language-server result is claimed; syntax/runtime checks were the requested
validation surface.

## Cleanup receipt and limits

Before cleanup, the owned home contained only `sentinel`, whose content was
still `USER-PROFILE-UNCHANGED` (22 bytes, SHA-256
`f5ade16cd5b24ab5675a82d6a068cf7589a9ef5e5112b399f3885c214dcbf415`).
Cache was empty and the forbidden Trail home did not appear. The auditor's
hardlink attack deliberately added a second link to this owned sentinel;
that harness action changed its link count, not its content, and was not a
profile write performed by the CLI. No real user profile was mutated.

ENOENT was independently asserted for `home/escaped`, `traversal-out`,
`linked-input-out`, `thin-failed-output`, `bad-failed-output`, and
`clean/.work`. Existing clean output had its full original inventory; the
existing empty output stayed empty.

Final cleanup executed:

```js
await fs.rm(root, { recursive: true });
await assert.rejects(fs.lstat(root), { code: "ENOENT" });
```

Here `root` was exactly the independently created `$R` above, not the shared
worktree or shared task parent. Both operations completed successfully.
All generated bundles, model/training fixtures, simulated home/cache, and
seven `trail-core-*` test directories left under this TMPDIR were removed
with it. No other lane's artifacts were removed.

No scoped contract is deferred for lack of evidence. The concrete blocker to
an overall PASS is the reproducible incomplete-identity success. No runtime
isolation claim is adjudicated PASS; runtime isolation remains unverified,
and live execution remains refused.
