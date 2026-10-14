# Fairness implementation evidence

Date: 2026-10-14. Runtime: Node v26.5.0. Repository: current Trail workspace.

## Outcome and scope

This is an intentional partial milestone: safe live refusal and corrected
read-only measurement, not a fully runnable fair benchmark. Every normal live
invocation exits with code 2 before reading task/config files, spawning a CLI,
starting a demo server, stopping a watcher, or changing shared state.
Browser/account memory isolation is unproven and no trusted verifier exists.
There is no unsafe bypass, isolation self-attestation flag, or accepted evidence
file. Enabling live runs requires a future independently verified isolation
implementation.

Changed files:

- `bench/bench.mjs`: strict argument parsing, unconditional fairness-first live
  refusal, and explicit read-only measurement CLI.
- `bench/measure.mjs`: session measurement, checked synchronous spawning, and
  exact new-session attribution.
- `test/bench.test.mjs`: eight fixture-based regression tests.
- `.omo/fairness-implementation.md`: this evidence report.

No source files, browser state, cookies, account memory stores, or existing
audit/ledger files were modified. No provider or Aside/Trail CLI calls were
made. Local Node subprocesses were used for syntax checks and fixture tests.
No commits were created.

## Measurement contracts

- Output has `schemaVersion: 2`, explicit session file and full session directory
  name, and `mode: "read-only-measurement"`.
- Measurement uses the exact supplied file, not discovery or a latest-session
  fallback. Its real path determines the account root when under
  `<account>/sessions/<session>/messages.jsonl`. An optional `--account-root`
  must match that real path; mismatch fails. Other explicit fixture layouts
  report `accountRoot: null`. No account-0 measurement default remains.
- Recorded assistant usage is summed; the single-message maximum is separately
  named `totalTokensMax`. Input, output, cache-read, cache-write, and reasoning
  fields remain separate. Missing usage fields contribute no recorded value.
  These numbers include repeated cache reads, are not normalized inference cost,
  and cannot account for usage absent from the log.
- Every assistant tool call counts, with per-name counts and `replCalls`
  retained. The old prompt-only 40-call threshold is labeled advisory,
  `enforced: false`, with an exceeded flag based on all tool calls.
- `done` checks only the last assistant's text against nonempty `doneCheck`
  strings. That message must contain no tool calls and have successful
  `stopReason` (`stop` or `end_turn`). Missing or non-success reasons, including
  `length`, fail. Prompt text, tool output, and earlier assistant answers do not
  satisfy completion. This remains a keyword completion heuristic, not semantic
  verification of the answer.
- Explicit `memory_search` calls, searches inside REPL code, and recognizable
  memory/Trail file references in read/shell/REPL tool arguments are flagged.
  This is a conservative log-based detector, not exhaustive proof of memory
  access or absence. Implicit injection and indirect/obfuscated reads remain
  unexcluded.
- `fairness.valid` is always false for this historical audit path, with reasons
  for absent browser/account isolation evidence and unexcluded automatic
  context injection. No detected memory access does not mean clean:
  `contamination.clean` is null, never true.
- Checked spawning throws on nonzero exit, spawn error, or signal termination.
  Exact exec attribution requires one reported session ID and exactly one new
  full-ID/date-prefix match, rejecting missing/ambiguous IDs and suffix guesses.
  These two primitives are implemented and tested but not reachable from the
  current CLI because live execution has been removed.
- Both `--only=x` and `--only x` parse. `--repeat N` accepts only a positive,
  canonical decimal safe integer. Unknown/duplicate options and invalid
  read-only/live combinations fail. Valid live arguments still refuse.
- `--rotate` refuses with an actionable explanation: rotating the former
  cold/learn/rerun sequence changes learning provenance; isolated replicas with
  identical learning inputs are needed. No balanced-rotation claim is made.
- Watcher stop verification is not reachable in this milestone. The CLI issues
  no watcher status/stop/start commands, so no watcher success is claimed.

## Exact checks and results

A new task-owned root was allocated with:

```sh
mktemp -d "${TMPDIR:-/tmp}/trail-fairness.XXXXXX"
```

Result (normalized path):
`/var/folders/m6/xsqcdfwn7618yqjqh1np5q200000gn/T/trail-fairness.m0EU7I`.

Both verification command sessions exported:

```sh
export TMPDIR='/var/folders/m6/xsqcdfwn7618yqjqh1np5q200000gn/T/trail-fairness.m0EU7I'
export NODE_COMPILE_CACHE="$TMPDIR/node-cache"
export BUN_RUNTIME_TRANSPILER_CACHE_PATH="$TMPDIR/bun-cache"
```

The syntax/regression command ran once:

```sh
node --check bench/bench.mjs &&
node --check bench/measure.mjs &&
node --check test/bench.test.mjs &&
node --test test/bench.test.mjs
```

Exit code 0. Eight tests passed; zero failures, cancellations, or skips.
Duration: 231.327459 ms. Coverage includes:

- Historical-style 126 total / 84 REPL accounting; sum versus maximum usage.
- Prompt/tool-only completion false; terminal failure and missing stop reason
  false; successful final text true; earlier answers cannot substitute.
- Memory search and explicit memory-read detection; absence remains unknown.
- Missing/ambiguous/old/suffix-guessed session attribution rejected.
- Local checked subprocess success, exit 7, SIGTERM, and ENOENT.
- Both only forms, strict repeat values, duplicate/unknown options, and
  read-only/live argument conflicts.
- Fairness refusal with filesystem read/write and subprocess APIs instrumented:
  recorded effects array remained empty. Rotation and self-attestation options
  did not permit execution.
- Actual CLI read-only measurement using temporary account/task/session
  fixtures; session content unchanged, account mismatch rejected, no-argument
  CLI exit 2, and valid live CLI invocation exit 2 with FAIRNESS-FIRST.

All new tests use temporary fixtures under the owned root and clean them via
test cleanup hooks; none read live session or memory stores.

Historical measurement command ran once, read-only:

```sh
node bench/bench.mjs \
  --measure-session "$HOME/.aside/u/0/sessions/2026-10-13_AZ3Kp7OZDrDpdAi7/messages.jsonl" \
  --task bench/tasks/coupang-tracking.json
```

Exit code 0. Selected output, captured from the command:

```json
{
  "schemaVersion": 2,
  "usage": {
    "messages": 127,
    "totalTokensSum": 10904881,
    "totalTokensMax": 262175,
    "input": 118294,
    "output": 146843,
    "cacheRead": 10639744,
    "cacheWrite": 0,
    "reasoning": 0
  },
  "toolCalls": 126,
  "replCalls": 84,
  "toolCounts": { "repl": 84, "bash": 42 },
  "done": false,
  "stopReason": "length",
  "budget": {
    "kind": "advisory",
    "toolCallLimit": 40,
    "enforced": false,
    "exceeded": true
  },
  "contamination": { "observed": false, "evidence": [], "clean": null },
  "fairness": {
    "valid": false,
    "reasons": [
      "browser isolation evidence absent",
      "account memory isolation evidence absent",
      "automatic context injection not excluded"
    ]
  },
  "session": "2026-10-13_AZ3Kp7OZDrDpdAi7",
  "accountRoot": "/Users/songyeongchan/.aside/u/0"
}
```

The three changed MJS files were inspected. `git diff --check` and the scoped
`git --no-pager diff --check -- bench/bench.mjs` produced no diagnostics.
The LSP tool reported that `typescript-language-server` is not installed;
language-server diagnostics were unavailable. No dependencies were added.
The full existing repository suite was not run: the requested bench target was
run once, and existing core tests include a live historical-store fixture.
No result for that broader suite is claimed.

## Cleanup receipt

After verification, the owned root (including runtime caches) was removed:

```sh
test -d '/var/folders/m6/xsqcdfwn7618yqjqh1np5q200000gn/T/trail-fairness.m0EU7I' &&
rm -r '/var/folders/m6/xsqcdfwn7618yqjqh1np5q200000gn/T/trail-fairness.m0EU7I' &&
test ! -e '/var/folders/m6/xsqcdfwn7618yqjqh1np5q200000gn/T/trail-fairness.m0EU7I' &&
printf 'CLEANUP_OK /var/folders/m6/xsqcdfwn7618yqjqh1np5q200000gn/T/trail-fairness.m0EU7I\n'
```

Exit code 0; the stated `CLEANUP_OK` line was observed. The old root named in the
pre-existing notepad was not created by this task and was left untouched.
No temporary browser, provider, or watcher session was started.
