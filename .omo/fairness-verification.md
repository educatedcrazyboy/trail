# Independent fairness verification

Date: 2026-10-14. Runtime: Node v26.5.0 on Darwin arm64.
Working directory: `/Users/songyeongchan/SongYeongChan/01_Personal/02_Code/04_Service/02_DesktopApp/Trail`.

## Verdict

**PASS for fail-closed live refusal and the tested historical-measurement
contracts. FAIL for any claim that this patch delivers a runnable, isolated,
fair benchmark.** Live execution has been removed, not made fair. No tested
input bypassed refusal. The implementation report describes this limitation
honestly; it does not claim full isolation.

I independently read all `bench/*.mjs` and `test/*bench*.mjs` files (two and
one respectively), `.omo/fairness-implementation.md`,
`.omo/fairness-patch-notepad.md`, and `docs/audit/fairness-verdict.md`.
I also read the historical command's task JSON. I executed the checks below
rather than adopting the producer's reported results.

Only this report was written by this verification. Test-created fixtures and
runtime caches were confined to my own temporary root and removed. No provider,
Aside/Trail execution CLI, browser, watcher, or demo-server request was launched.
Local Node child processes were used. No commit was made. Pre-existing changes,
audit artifacts, other temporary roots, and user state were left alone.

## Requirement verdicts

| Requirement | Verdict | Independent evidence |
|---|---|---|
| Missing arguments print usage and exit nonzero | PASS | Real CLI: exit 2, empty stdout, usage on stderr (C2). |
| Missing isolation refuses before benchmark CLI spawn or state mutation, not after measurement | PASS | `main` parses, then synchronously throws from `requireLiveIsolation`, before task read or measurement. All 41 function APIs in `fs.promises` and `child_process` were replaced with throwing traps after module import; seven inputs rejected with zero effects (C3). Real nonexistent-task invocation reports fairness refusal, not ENOENT (C2). |
| Dirty, absent, or unsupported isolation evidence cannot enable execution | PASS, by unconditional refusal | There is no accepted evidence input or verifier. Unsupported proof and unsafe flags exit 2. Environment sentinels do not change refusal (C2). This is not evidence validation. |
| No unsafe bypass | PASS within inspected entry point | Parser allowlist plus unconditional live throw; no environment lookup, caller boolean, evidence file, or alternate live branch. C2/C3 exercise unsupported flags. Not a guarantee against externally modified code or arbitrary Node loaders. |
| Exact-host cleanup does not establish isolation | PASS for policy; isolation remains unimplemented | Current CLI performs no host cleanup and always refuses live work. Historical results always set `fairness.valid:false` and `contamination.clean:null`. |
| Rotation honestly rejects unsupported execution | PASS | Real `--rotate` exits 2 with learning-provenance explanation and isolated-replica prerequisite (C2); zero trapped effects (C3). Rotation alone would not isolate browser or account memory. |
| Metric fields distinguish sums, maxima, and cache usage | PASS | Schema 2, explicit mode/session/path/root; fixture and independent six-field sum assertions pass. Historical sum and maximum independently reduced from raw log agree (C1/C4/C5). No normalized-cost claim is made. |
| Every assistant tool call counts | PASS | Historical 126 total = 84 REPL + 42 bash. Independent adversarial names including `__proto__` count correctly (C4/C5). Counts are logged calls, not all work nested inside a REPL call. |
| Completion uses only final assistant text and successful stop reason | PASS for documented heuristic | Existing fixtures reject prompt/tool/earlier-answer matches, missing stop reason, failure reasons, and mixed tool/text final messages. Independent earlier-answer and user/tool-only cases fail; string final text with `end_turn` succeeds (C1/C5). Historical `length` yields false (C4). |
| Advisory budget is not called enforced | PASS | Output is `kind:"advisory"`, `toolCallLimit:40`, `enforced:false`, `exceeded:true` for historical 126 calls. |
| Parser handles both only forms and rejects malformed input | PASS | C1 and C5 check equals/separate `--only`, repeat validation, duplicates, unsupported flags, and live/read-only conflicts. Valid live forms still refuse. |
| Session matching rejects guesses, old sessions, ambiguity, and account mismatch | PASS for implemented primitives | Fixtures test missing/multiple reported IDs, date-prefix ambiguity, suffix guesses, old sessions, and wrong account root. C5 independently checks full ID, old ID, and suffix rejection. Historical CLI uses explicit path plus explicit account root (C4). |
| Subprocess failures are checked | PASS for dormant helper | C1 covers exit 7, SIGTERM, ENOENT, and successful stdout. `checkedSpawnSync` is not reachable from current live CLI; no operational watcher/cleanup reliability follows. |
| Memory observations do not imply cleanliness | PASS | Explicit search/read fixtures flag contamination. Independent indirect `await f(p)` is not detected, but still yields unknown cleanliness and invalid fairness (C5). Automatic injection is not excluded. |
| Historical session gives 126 total, 84 REPL, done false | PASS | C4 actual CLI and separate raw-log reducer agree; stderr empty, exit 0. |
| Owned temporary resources are cleaned with receipt | PASS | C6 exit 0 and observed `CLEANUP_OK`; root no longer exists. |
| Fully isolated live benchmark and verified watcher normalization | FAIL / BLOCKED | Not implemented or reachable. Safe refusal is the only live guarantee. |
| Whole repository suite green | BLOCKED / NOT VERIFIED | Only the scoped bench suite was run. The notepad's broader `node --test` criterion is not established by this verification. |

## Verified commands and outputs

All Node commands below used these environment settings, including children:

```sh
export TMPDIR='/var/folders/m6/xsqcdfwn7618yqjqh1np5q200000gn/T/trail-independent-verification.6qYSil'
export NODE_COMPILE_CACHE="$TMPDIR/node-cache"
export BUN_RUNTIME_TRANSPILER_CACHE_PATH="$TMPDIR/bun-cache"
```

The root was independently allocated using
`mktemp -d "${TMPDIR:-/tmp}/trail-independent-verification.XXXXXX"`.
The returned path had a harmless doubled slash before its basename; the
normalized path above identifies the same directory.

### C1. Syntax and fixture suite

```sh
node --version
node --check bench/bench.mjs &&
node --check bench/measure.mjs &&
node --check test/bench.test.mjs &&
node --test test/bench.test.mjs
```

Exit 0. Node v26.5.0. Eight tests passed, zero failed, skipped, cancelled,
or todo; duration 272.852416 ms. The suite ran once. Its local subprocess
failure tests and temporary read-only CLI fixture were inspected before running.

### C2. Actual invalid CLI invocations

Executed each through `spawnSync(process.execPath, ["bench/bench.mjs", ...args],
{encoding:"utf8", env:{...process.env, FAIRNESS_ISOLATED:"true",
TRAIL_BENCH_UNSAFE:"1"}})` in a `node --input-type=module -e` harness.
The harness asserted status 2, empty stdout, and the expected stderr pattern
for every case, then exited 0. These environment names are adversarial
sentinels, not advertised implementation options.

```sh
node bench/bench.mjs
node bench/bench.mjs /nonexistent/fairness-task.json --only=cold
node bench/bench.mjs /nonexistent/fairness-task.json --rotate
node bench/bench.mjs /nonexistent/fairness-task.json --unsafe
node bench/bench.mjs /nonexistent/fairness-task.json --isolation-proof=clean
```

Each child exited 2 with signal null and stdout `""`. Respective stderr:

```text
usage: node bench/bench.mjs <task.json> [--only cold|trail-on|trail-off] [--repeat N]
       node bench/bench.mjs --measure-session <messages.jsonl> --task <task.json> [--account-root <dir>]

FAIRNESS-FIRST: live benchmark refused before any CLI spawn or state mutation. Browser/account memory isolation is unproven; no trusted isolation verifier exists. Implement independently verified browser and account-memory isolation before enabling live runs. Use --measure-session <messages.jsonl> --task <task.json> for read-only historical measurement.

--rotate is unsupported: rotating the current cold/learn/rerun sequence changes learning provenance. Implement isolated replicas with identical learning inputs before enabling rotation; no calls were made.

unsupported option: --unsafe

unsupported option: --isolation-proof=clean
```

These are five separate stderr captures, separated above by blank lines.
The missing-isolation invocation deliberately names a nonexistent task.
It cannot have loaded or measured that task before refusing.

### C3. Independent preflight effect traps

Executed this body using `node --input-type=module -e` with the environment
above. Exit 0:

```js
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { main } from "./bench/bench.mjs";
const effects = [];
let n = 0;
for (const [group, obj] of [["fs.promises", fs], ["child_process", cp]]) {
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "function") {
      obj[key] = (...args) => {
        effects.push(group + "." + key);
        throw Error("unexpected " + key);
      };
      n++;
    }
  }
}
syncBuiltinESMExports();
for (const args of [
  [], ["missing.json"], ["missing.json", "--only=trail-off"],
  ["missing.json", "--repeat=2"], ["missing.json", "--rotate"],
  ["missing.json", "--unsafe"], ["missing.json", "--isolation-proof=clean"],
]) {
  await assert.rejects(main(args));
}
assert.deepEqual(effects, []);
console.log(JSON.stringify({ guardedAPIs: n, cases: 7, effects }));
```

Observed `{"guardedAPIs":41,"cases":7,"effects":[]}`.
This is independent instrumentation, wider than the existing fixture's
selected API traps. Imports occur before instrumentation: Node module loading
and compile-cache writes are not claimed absent. Static inspection of both
modules found declarations/imports only at load time; the entry-point guard
does not execute on import. The trap is not a universal operating-system
syscall monitor, but covers every filesystem/subprocess API used by the
inspected implementation, with the static ordering providing the causal check.

### C4. Historical CLI and independent reduction

Actual child command, executed with captured stdout/stderr:

```sh
node bench/bench.mjs \
  --measure-session "$HOME/.aside/u/0/sessions/2026-10-13_AZ3Kp7OZDrDpdAi7/messages.jsonl" \
  --task bench/tasks/coupang-tracking.json \
  --account-root "$HOME/.aside/u/0"
```

Child exit 0, signal null, stderr `""`; enclosing assertion harness exit 0.
Selected actual output:

```json
{
  "schemaVersion": 2,
  "mode": "read-only-measurement",
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
  "toolCounts": {"repl": 84, "bash": 42},
  "done": false,
  "stopReason": "length",
  "budget": {
    "kind": "advisory",
    "toolCallLimit": 40,
    "enforced": false,
    "exceeded": true
  },
  "contamination": {"observed": false, "evidence": [], "clean": null},
  "fairness": {
    "valid": false,
    "reasons": [
      "browser isolation evidence absent",
      "account memory isolation evidence absent",
      "automatic context injection not excluded"
    ]
  },
  "session": "2026-10-13_AZ3Kp7OZDrDpdAi7",
  "sessionFile": "/Users/songyeongchan/.aside/u/0/sessions/2026-10-13_AZ3Kp7OZDrDpdAi7/messages.jsonl",
  "accountRoot": "/Users/songyeongchan/.aside/u/0"
}
```

The independent harness read the raw JSONL before invoking the CLI, parsed
each nonblank line, iterated only assistant messages, counted each `toolCall`
and each exact `repl` name, summed `usage.totalTokens`, took its maximum,
and retained the last assistant's stop reason. It did not import the
measurement implementation. Assertions independently established:

```json
{"total":126,"repl":84,"sum":10904881,"max":262175,"stopReason":"length"}
```

The harness SHA-256 hashed the session bytes before and after CLI execution
and asserted equality. Observed hash:
`14ca0fd17c9329a54d528263c599bf03d9ea6391ae7ca9ab411e47bbab69d487`.
This proves this measured file stayed byte-identical, not global user-state
equivalence. Read-only behavior also follows from the inspected call path.

### C5. Additional independently chosen adversarial assertions

A separate `node --input-type=module -e` assertion harness imported
`measureMessages`, `attributeSession`, and `parseArgs`; exit 0.
It checked:

- Two assistant usages with totals 11 and 13 produce sum 24 and max 13;
  input/output/cacheRead/cacheWrite/reasoning pairs sum to 3/5/7/9/11.
- Tools named `__proto__` and `other` produce two calls and one
  `toolCounts.__proto__`, without prototype-key loss.
- Negative input, NaN output, infinite total, and string cache-read values
  each throw.
- A final string answer with `end_turn` and matching keyword succeeds;
  an earlier matching assistant followed by an unmatched assistant fails;
  user/tool-result-only matches fail.
- An indirect REPL expression `await f(p)` is undetected, but its result
  still has `contamination.clean:null` and `fairness.valid:false`.
- Exact full session ID matches; an already-existing ID and arbitrary
  suffix guess reject.
- Repeat strings `0`, `-2`, `1.0`, `1e2`, `01`, and
  `9007199254740992` reject. Both argument forms for all three `only`
  values parse exactly.

Observed output:

```text
ADVERSARIAL_PASS sums, final-only completion, arbitrary tool names, invalid usage, parser, exact session matching; indirect memory remains unknown
```

### C6. Cleanup receipt

After every Node verification child had exited:

```sh
test -d '/var/folders/m6/xsqcdfwn7618yqjqh1np5q200000gn/T/trail-independent-verification.6qYSil' &&
find '/var/folders/m6/xsqcdfwn7618yqjqh1np5q200000gn/T/trail-independent-verification.6qYSil' -maxdepth 2 -print &&
rm -r '/var/folders/m6/xsqcdfwn7618yqjqh1np5q200000gn/T/trail-independent-verification.6qYSil' &&
test ! -e '/var/folders/m6/xsqcdfwn7618yqjqh1np5q200000gn/T/trail-independent-verification.6qYSil' &&
printf 'CLEANUP_OK /var/folders/m6/xsqcdfwn7618yqjqh1np5q200000gn/T/trail-independent-verification.6qYSil\n'
```

Exit 0. The listing contained only the root, `node-cache`, and its
`v26.5.0-arm64-8d7ad2ee-501` subdirectory at the inspected depth. Fixture
directories had been removed by test hooks. Observed:

```text
CLEANUP_OK /var/folders/m6/xsqcdfwn7618yqjqh1np5q200000gn/T/trail-independent-verification.6qYSil
```

## Explicit blockers and boundaries

1. There is no trusted browser/account-memory isolation verifier, isolated
   browser replica, or executable balanced comparison. Exact-host cleanup and
   rotation would not establish isolation even if added. No live fairness
   claim is supported.
2. Watcher stopping, cleanup command success in a live run, and future
   session attribution integration are untested because those execution
   paths do not exist. Tested helper behavior is not end-to-end integration.
3. Completion remains a keyword heuristic, not answer correctness. Usage
   measures recorded assistant fields, including repeated cache reads, not
   provider billing, absent usage, or normalized inference cost. Contamination
   scanning cannot exclude indirect reads or automatic context injection.
4. No provider/browser experiment or full repository suite was run. These
   were outside this local-only scoped verification. No LSP/build result is
   claimed for the report-only change; MJS syntax and targeted tests passed.
5. The historical verdict document describes the former implementation and
   old line numbers. Its causal claims and the other historical audit files
   were not independently re-audited here. This patch does not retroactively
   validate old comparisons or prove their measured differences causal.
6. The notepad's ideal plan includes repository-wide testing and commits.
   Those are not completed by this report; this task explicitly forbids
   commits. The producer correctly labels the implementation a partial
   milestone rather than completion of that ideal plan.

No contradiction was found in the narrow implemented refusal/measurement
contracts tested here. The unresolved isolation requirement must remain a
blocker, not be relabeled as a passing fair-benchmark result.
