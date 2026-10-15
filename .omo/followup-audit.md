# Corrected follow-up audit handoff

## Delivered correction

The previous completion missed the requested correction. Its three-session coverage claim and related cost/repetition conclusions are superseded.

- `bench/audit.mjs` now parses archived JSON `results[].session` bare 16-character IDs, lists only immediate dated Aside directories, requires one exact suffix match, and combines bare/directory references to the same session. Missing IDs/logs and ambiguous matches are explicit; ambiguous candidates are never read.
- `pin()` now opens one descriptor, captures its initial `fstatSync().size`, and bounds every read to that size. Recorded token volume is no longer described as billed volume.
- Explicit read-target hashing recognizes Aside `read_file` as well as Senpi `read`.
- `test/audit.test.mjs` now has **12 tests**. Existing repository tests and the unconditional live gate were not modified.

## Regression evidence

Before the fix, `node --test test/audit.test.mjs` exited **1**. The structured-ID regression expected three references (two bare plus one dated) but got one; the missing-ID regression expected a reported unresolved ID but got an empty list.

The deterministic append-after-stat regression, run with:

```sh
node --test --test-name-pattern="pin excludes bytes" test/audit.test.mjs
```

exited **1** before the fix: **491 pinned bytes versus initial size 244**. The append is triggered synchronously after stat, with no sleeps or timing luck. The existing repetition test was also extended: pre-fix read-target count **2**, expected **3** when read_file was included.

After corrections:

- `node --test test/audit.test.mjs`: **12 pass, 0 fail**, exit **0**.
- `node --test test/*.test.mjs`: **76 pass, 0 fail, 0 skipped**, monitored Node exit **0**. The actual invocation expands to audit, bench, core, e2e, local, and prepare test files.
- Actual CLI command is recorded in `docs/audit/followup-cost-audit.md`; exit **0**. It loaded **120/120** uniquely resolved Aside sessions referenced by **41** archived files. Missing/ambiguous Aside matches: **0/0**.
- LSP diagnostics were attempted but unavailable: TypeScript language server and Biome are not installed. No dependencies were added.

## Corrected actual artifact

`docs/audit/followup-cost-audit.json` is the actual sanitized CLI stdout, installed through apply_patch: **794,374 bytes**, SHA-256 **1e697363de86fcb11a73fb49cfc7449e34a07c24cb7260fab323809e0fc73ebe**.

Aside: **1,638 assistant messages**, **135,443,827 summed totalTokens**, max **415,799**, cache share **86.20%**, recorded cost **2.143249039 USD**. Repetition: **112 excess identical calls**, **173 error results**. These replace the earlier three-session claims.

All-unique union: **124 inputs**, **561,336,583 totalTokens**, **20.917247439 recorded USD**. This is not billing.

Child lookup was not broadened. `st_01a120fd` and `st_01a1388c` remain unavailable in the bounded lookup; no usage was guessed. Native DAG stats remain separate. All inputs carry initial size, bounded read size, prefix hash, and `final:false`.

## Write scope and cleanup

This correction used apply_patch exclusively for code/report edits. Only the five original deliverable paths were edited. Runtime fixtures/caches were confined to private task root `audit-correction-JfQvhD`. No Aside/provider execution, user-profile writes, commits, dependencies, or delegated workers.

Cleanup receipt: removed `/var/folders/m6/xsqcdfwn7618yqjqh1np5q200000gn/T/audit-correction-JfQvhD` with recursive rmSync after the final checks. A subsequent statSync returned **ENOENT**. No commands that use the task cache environment were run after removal.
