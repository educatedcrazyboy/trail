# G005 final review: APPROVE

Date: 2026-10-15. Worktree: `/tmp/trail-controls.dbpf1i/worktree`.

**APPROVE. C001, C002 and C003 pass. No scoped criterion blockers.**
This is approval of the local controls, not Aside runtime isolation or a
performance/fairness result. All seven requested files were inspected in full.
No code/test edits, commits, provider/browser calls, or user-state changes were made.

## C001: PASS - generated frozen treatment and independent accounts

`bench/prepare.mjs:120-150` reduces training to sanitized structural navigation;
`:243-268` calls Trail extraction/distillation/emission with explicit owned
home/account paths and finalizes one snapshot before creating arms.
`:22-29,153-165,274-285` define all six orders and create 18 separate account
directories, copying frozen files only for on arms. `:64-108,175-220` checks
file hashes, allowlisted topology, the reconstructed manifest, and actual arms.

Executed the real preparation and verification commands below: both exited 0,
reported 18 arms, `runtimeIsolation: "unverified"`, `liveAllowed: false`, and
the same frozen inventory SHA-256:
`11479430947b1ada50f910ec8ad7c78d6c31977105217dd50a5aa6d4fa790079`.
Independent artifact inspection found 18 distinct account directory inodes,
12 empty cold/off accounts, four frozen files and 24 matching on files.
All 28 treatment files had distinct inodes and link count 1. Read-tool content
comparisons matched every on copy; UTF-8 byte lengths matched file sizes.
Recomputing the frozen inventory hash from inspected content reproduced the
CLI hash. The generated skill contained the learned `/compose` shortcut.

The passing suite additionally performs direct Buffer equality, input-hash,
six-order balance, and secret-sentinel assertions in
`test/prepare.test.mjs:39-110`. Sanitization is navigation-only, not a general
PII guarantee; frozen means finalized/shared input, not OS-enforced immutability.

## C002: PASS - rejection controls and unconditional live gate

`bench/prepare.mjs:36-82,188-217` rejects traversal, symlinks/hardlinks,
unallowlisted topology and inventory mismatches. Expected arms are reconstructed
from the frozen tree rather than accepted from caller-supplied arm inventories.
Passing tests at `test/prepare.test.mjs:113-201` exercise modified/deleted/extra
files, extra directories, forged hashes/baselines, link attacks and malformed
manifests. The real CLI test at `:225-246` creates and verifies a bundle, adds
a root tamper file, and requires exit 2.

The prior blocker in `.omo/g005-verify.md:23-54` is fixed:
`bench/measure.mjs:33-39` accepts only top-level logged identity, and `:45-77`
rejects either missing identity field before comparing any requested field.
`bench/bench.mjs:84-106` propagates failure as `verified: false` and exit 2.
The passing regression at `test/bench.test.mjs:353-375` executes six real CLI
rejections: model-only, provider-only and nested-only metadata, each against
model-only and provider-only expectations. Exact/mismatched/mixed identity
checks also pass at `:189-319`. The old FAIL report remains historical evidence,
not an unresolved current finding. I did not revert code to replay the reported
failing-before run.

Independent read-only historical CLI runs observed all four assistant responses
(messages 4, 6, 8 and 10) as `opengateway/z-ai/glm-5.3-flash-ultrafast`.
Exact GLM/provider expectation exited 0 with `verified: true`; Muse expectation
exited 2 with four mismatches and `verified: false`.
`bench/bench.mjs:66-82` still throws unconditionally before task-file access
for live mode. A live invocation naming a nonexistent task exited 2 with
`FAIRNESS-FIRST`; the no-side-effects regression at
`test/bench.test.mjs:153-170` also passed.

## C003: PASS - regressions, real CLI evidence and honest limits

Independently reran the full stated suite once: **44 tests, 44 pass, 0 fail,
0 skipped; exit 0**, Node v26.5.0. All three source syntax checks exited 0.
The actual CLI evidence above is from this review, not only the lead's report.
`docs/audit/local-fairness-controls.md:5-18,39-44,55-71,87-94` explicitly separates
local file controls from runtime isolation and preserves the prior failed audit.
`bench/measure.mjs:140-174` continues to report fairness false and unobserved
contamination as unknown. No runtime-isolation claim is approved or required
for these scoped criteria. Hashes do not authenticate a coherently replaced
whole bundle; logged identities do not establish routing, effort or log authenticity.

## Commands and execution environment

The reviewer created `R` using `mktemp -d /tmp/trail-g005-final.XXXXXX`.
Commands ran from the worktree with these overrides; the historical input was
read-only, using an absolute path rather than the substituted HOME.

```sh
W=/tmp/trail-controls.dbpf1i/worktree
R=/tmp/trail-g005-final.FJYd4v
cd "$W"
export HOME="$R/home" TRAIL_HOME="$R/home/forbidden"
export XDG_CACHE_HOME="$R/cache" TMPDIR="$R"
export NODE_COMPILE_CACHE="$R/node-cache"
export BUN_RUNTIME_TRANSPILER_CACHE_PATH="$R/bun-cache"

node --check bench/prepare.mjs
node --check bench/measure.mjs
node --check bench/bench.mjs
node --test test/core.test.mjs test/e2e.test.mjs test/bench.test.mjs test/prepare.test.mjs
node bench/prepare.mjs prepare --training-session test/fixtures/run1.messages.jsonl \
  --model fixture/local-model --effort high --out "$R/prepared"
node bench/prepare.mjs verify "$R/prepared"

S=/Users/songyeongchan/.aside/u/0/sessions/2026-10-13_vjVvZC2H5GW7OeDN/messages.jsonl
node bench/bench.mjs --measure-session "$S" --task bench/tasks/youtube-top-video.json \
  --expected-model z-ai/glm-5.3-flash-ultrafast --expected-provider opengateway
node bench/bench.mjs --measure-session "$S" --task bench/tasks/youtube-top-video.json \
  --expected-model openrouter/meta/muse-spark-1.3-contributor
node bench/bench.mjs "$R/missing-task.json" --model fixture/local-model
```

Expected exits in order: syntax/suite/prepare/verify/GLM all 0; Muse and live 2.
Both execution monitors completed with exit 0 after asserting expected exits.
The suite's real CLI root-tamper invocation is
`node bench/prepare.mjs verify <owned-test-root>/prepared`, after adding `tamper`;
its required exit 2 passed.

## Cleanup receipt

Before cleanup, owned HOME and XDG cache were empty; `home/forbidden` and
`prepared/.work` were absent. Node compilation created only the redirected
`node-cache`; no Bun cache appeared. Seven existing core-test temporary
directories remained under the owned TMPDIR and were included in cleanup.

Executed `await fs.rm("/tmp/trail-g005-final.FJYd4v", { recursive: true })`,
then asserted `fs.lstat` rejected with `ENOENT`: **PASS**. This removed only
the reviewer's root, including generated preparation, test remnants and caches.
No pending processes remain from the two completed monitors. This report is
the only retained file written by this review.
