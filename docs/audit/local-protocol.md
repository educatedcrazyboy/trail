# Local mock benchmark protocol

`node bench/local.mjs --protocol bench/protocol.json --out <new directory> [--fault <scenario>]`

This is a deterministic, no-model mock. It exercises harness mechanics (dispatch budgets, bounded
responses, deadlines, structured judging, evidence, cleanup). It makes no claim about AI, browser,
runtime, fairness, or performance, and it does not touch Aside, providers, or any user profile.

## What runs

- A loopback HTTP server on an ephemeral port serves four fixed synthetic tasks (shipment, stats, paper,
  video). Each has an index page, a list page, and a detail page; the detail page carries a `Summary:` line
  plus decoy lines (stale status, a different statistic, and so on).
- A scripted solver (no model) fetches pages over HTTP and submits JSON: answer fields plus a source
  `{url, quote}`.
- Schedule: six condition orders x three conditions = 18 arms; each arm runs all four tasks against the same fixture truth.
  Conditions are exactly `cold`, `trail-on`, and `trail-off`. `trail-on` fetches the detail page directly
  (the mock treatment route shortcut). `cold` and `trail-off` navigate
  index -> list -> detail. The shortcut is a synthetic policy, **not emitted by Trail**, labelled
  "synthetic policy, not measured Trail advantage"; no Trail advantage is measured.

## Preregistration

`bench/protocol.json` pins, before any action: SHA-256 of the actual `bench/local.mjs` executor,
both fixture files and the oracle module, a SHA-256 per
task (canonical JSON), the treatment hash, model `fixture/local-model`, effort `not applicable`, limits, schedule,
and the failure/aggregation/exit rules. Any pin mismatch refuses the run. `before.json` is written (with
`requestCount: 0`, `actionsStarted: false`) before the server starts; `after.json` records its SHA-256 and that it
was unchanged. Schema, exact repository source/fixture paths (no traversal or symlinks), exact condition
routes, and schedule shape are validated before pinned files are read or the server starts.

## Enforced limits

| Limit | Enforcement |
| --- | --- |
| `maxCallsPerArm`, `maxCallsTotal` | Checked before each dispatch; the over-budget request is never sent (server sees exactly the cap). |
| `maxResponseBytes` | Counted on the `data` stream; the socket is destroyed at the cap (a 16 MiB stream is cut off, not read then truncated). |
| `armWallMs`, `totalWallMs` | AbortController deadlines; pending requests are aborted and counted in the cleanup receipt. |
| `requireObservedTokens` | A response without a valid `x-synthetic-tokens` header is rejected (`usage_unknown`) and stops dispatch. |
| `observedTokenCeilingPerArm` | Checked after each response; stops *further* dispatch only. An in-flight call can overshoot it. |

Token telemetry is synthetic (a header from the fixture server). No paid-model cap exists or is claimed.
Only paths of the form `/segment/...` are dispatchable, always to `127.0.0.1:<port>`; no external URL, command, or process.

## Oracle (`bench/local-oracle.mjs`)

Passes only if the answer has exactly the truth keys with exact values AND the source URL was fetched in the arm,
is the authoritative detail page, and the quote equals its complete, unique `Summary: ` line.
Semicolon-space-separated `field=value` entries are parsed into exact keys and values; the key set must
equal the task's evidence fields and every value must equal its truth. Duplicate keys (identical or
conflicting), extra/prefixed keys, longer values (`year=20240` versus `2024`), partial lines, non-Summary
lines, and multiple Summary lines fail. Keyword-only, stale-quote, unfetched-page, or whole-page
submissions fail. Oracle SHA-256: `078b9a46a4ecac1344447fbf263dec57c5c5c74e5a76b51c34bac74007cc88b9`.

## Adversarial fixtures (`bench/fixtures/local-adversarial.json`)

too_many_calls, oversized_response, never_answers, unknown_usage, token_ceiling, malformed_answer, wrong_answer,
missing_source, fabricated_quote, unfetched_source, decoy_quote, wrong_source_page, whole_body_quote. Each
declares its expected code and request count. A normal run requires every one to be rejected as declared.
`--fault <id>` injects one into arm 1; the run must then exit 2.

## Evidence and exit codes

`before.json` / `after.json` link protocol, runner, fixtures, task, oracle, and treatment hashes; the full request log and
count; usage semantics; per-arm and per-task completion and errors; per-condition counts; and a cleanup receipt
(server closed, pending requests aborted and none remaining, no open sockets, no extra files in the output
directory). No timestamps, so identical runs produce identical `after.json`.
`--out` uses exclusive nonrecursive mkdir under an existing parent. Existing files, directories, and
symlinks (including dangling ones) are refused without changing them.
Exit 0 only if all arms pass, all scenarios are rejected as declared, cleanup is clean, and `before.json` is unchanged;
otherwise 2 (including usage errors).

## Limits of this evidence

The scripted solver and fixture truth are synthetic and tiny. The test proves harness enforcement, not
anything about a real agent, browser, or site. These are consistency pins, not an independent trust anchor:
changing both executor and protocol is not prevented. After intentional source changes, regenerate the matching
SHA-256 (tasks/treatment use recursively key-sorted JSON; treatment excludes its own hash) before running.
