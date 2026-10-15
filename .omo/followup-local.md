# Handoff: local mock benchmark

Status: corrections implemented and verified on October 15, 2026. No commits made.

## Artifacts
- `bench/local.mjs` (runner, CLI), `bench/local-oracle.mjs` (task-specific oracle)
- `bench/protocol.json` (pins executor/fixture/task/oracle/treatment hashes, limits, schedule, rules)
- `bench/fixtures/local.json`, `bench/fixtures/local-adversarial.json`
- `test/local.test.mjs` (17 tests), `docs/audit/local-protocol.md`

## Commands
- Before the oracle fix, `node --test --test-name-pattern='oracle requires exact authoritative' test/local.test.mjs`
  exited 1: `Summary: year=20240` incorrectly passed.
- After the fix, `node --test test/local*.test.mjs`: exit 0, 17 passed, 0 failed (one full run).
- `node --test "${files[@]}"`, where the shell array contains every `test/*.test.mjs`
  except `test/local*.test.mjs`: exit 0, 56 passed, 0 failed in the preceding correction.
  Existing tests were not edited.
- `node bench/local.mjs --help`: exit 0 (also exercised by the current local suite).
- `node bench/local.mjs --protocol bench/protocol.json --out "$TMPDIR/happy"`:
  exit 0, all 18 arms passed; all 13 adversarial checks rejected as expected; 209 logged requests.
- Current direct CLI `--fault wrong_answer` and `--fault fabricated_quote`: exit 2 with
  `wrong_answer` and `quote_not_in_source` respectively. The suite additionally injected all
  13 scenarios and verified every run failed. Output reuse remained rejected.
- All CLI evidence cleanup receipts: server closed, zero pending requests/open sockets,
  every hanging request aborted, no extra output/cache files.
- Diagnostics were requested for all changed files. TypeScript/Biome language servers are absent;
  Markdown has no configured server. No dependencies installed. `git diff --check`: exit 0.

## Evidence receipt
The happy run linked identical pins in before/after JSON:
- Runner SHA-256: `9726902e16c51bebac69d3f32715028e8a35f416dfc942f84b769d816bfaa9f8`.
- Oracle SHA-256: `078b9a46a4ecac1344447fbf263dec57c5c5c74e5a76b51c34bac74007cc88b9`.
- Protocol SHA-256: `7d067f26bfdef3972f4be8312c4dfa541320acadc081969f47f8cdbc21144191`.
- Before SHA-256: `e965fb9ace6a7c8021b78d51c75616902d488fb9acc0743b76cb20f8b7a04121`.
- After SHA-256: `ee41d8ccdaf5d1e8ffc1e944097f4afd8cd8a8894987cb0c71c04b8385217057`.
Fixture/task/oracle/treatment pins remain in the protocol and both generated evidence files.
Cold and trail-off each passed six navigation arms (72 calls each); trail-on passed six synthetic
shortcut arms (24 calls). These are harness counts, not performance or Trail-advantage evidence.

## Temporary cleanup
Created `/tmp/trail-oracle-task.YMeNpT` with `mktemp` before other commands. Every command exported
`TMPDIR`, `NODE_COMPILE_CACHE`, and `BUN_RUNTIME_TRANSPILER_CACHE_PATH` beneath it.
Removed the entire root, including all CLI JSON evidence and runtime caches; `lstatSync` verified
`ENOENT`, and the shell absence check exited 0. Compile caching was disabled for cleanup to prevent
exit-time recreation. The hashes above retain the verification receipt, not the removed JSON files.

## Regenerating pins
After editing the executor, a fixture, the oracle, or the treatment, recompute the matching sha256 in `bench/protocol.json`
(canonical JSON = recursively key-sorted `JSON.stringify` for tasks and treatment minus its `sha256`). A stale pin
fails with `pin_mismatch`.

## Caveats / follow-ups
- Conditions are exactly `cold`, `trail-on`, `trail-off`; only `trail-on` uses the synthetic shortcut.
- The shortcut is not Trail output; it shows no Trail advantage.
- Token telemetry is synthetic; the ceiling only stops later dispatch. No paid-model cap is claimed.
- Both evidence files include the verified executor hash. Wrong executor pins fail before output/server creation.
- Exact repository paths and schema are validated before pinned reads. Traversal is refused.
- Exclusive nonrecursive mkdir refuses existing directories/files/symlinks unchanged; the parent must exist.
- Oracle evidence now requires the complete unique authoritative Summary line, with exact parsed
  evidence keys and truth values. Regressions cover longer values, prefixed keys, identical/conflicting
  duplicates, partial lines, non-Summary lines, and multiple authoritative Summary lines.
- Live gate and `bench/{prepare,measure,bench}.mjs` were not edited.
