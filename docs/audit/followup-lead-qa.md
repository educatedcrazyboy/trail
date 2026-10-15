# Lead real-surface verification — 2026-10-15

## Preparation lifecycle and external pin: PASS

Tool: JS eval `tool.bash`, Node `spawnSync` asserting actual subprocess
status, not a shell pipeline status. Task cache environment pointed to
`/tmp/trail-followup.93DyJO`.

```sh
node bench/prepare.mjs prepare \
  --training-session /tmp/trail-followup.93DyJO/lifecycle.jsonl \
  --model fixture/local-model --effort off \
  --out /tmp/trail-followup.93DyJO/prepared
node bench/prepare.mjs verify /tmp/trail-followup.93DyJO/prepared \
  --expected-manifest-sha256 4e0b08c7b87b81e46206807b2fc5d94ab23a29075cd3666ebd1c571d43f9620a
node bench/prepare.mjs verify /tmp/trail-followup.93DyJO/prepared \
  --expected-manifest-sha256 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

The synthetic navigation fixture had a matching started/finished turn
envelope after a successful assistant answer, using the shape observed in
the existing Aside log. Actual outcomes:

| Scenario | Required | Observed |
| --- | --- | --- |
| Prepare lifecycle fixture | exit 0, 18 arms | exit 0, 18 arms |
| Original independently supplied manifest hash | exit 0, pinned true | exit 0, pinned true |
| Wrong external pin | exit 2 | exit 2, `manifest does not match the externally pinned sha256` |

All three outputs kept `liveAllowed:false`; runtime isolation remained
unverified. Frozen inventory hash was
`4aae65214d8d4a3b6730e9d47a9dc12e3daefabeb942656108108b2f184f10b0`.
This is a particular generated bundle, not a hash promised for future runs.

Cleanup: removed only the owned generated bundle and synthetic fixture.
Read-back checks returned `PREPARE_LEAD_QA_CLEANUP_OK`, exit 0.
The parent task root remains owned until all remaining QA finishes.

## Historical correction data: PASS

Node parsed every JSONL record in `docs/audit/historical-corrections.jsonl`
and asserted `preserveOriginalArtifacts === true`,
`newLiveBenchmarksRun === false`, `fairness.eligibleForCausalComparison === false`
and existence of every evidence path.

Actual stdout, exit 0:

```json
{"correctionRecords":1,"originalsPreserved":true,"causalEligibility":false,"evidencePathsExist":true}
```

This is a data/prose correction, not a new task-success score. No process
or temporary resource was created by the validator. An earlier inline
invocation had an escaped-newline syntax error (exit 1); the corrected
invocation used `split(String.fromCharCode(10))` and performed the checks.

## Local HTTP mock and structured oracle: PASS

Tool: JS eval `tool.monitor`, Node `spawnSync` checking each actual CLI status.
Monitor `mon_28NAHQ23G8NPW99Q` completed exit 0, `LEAD_LOCAL_ALL_PASS`.

```sh
node bench/local.mjs --help
node bench/local.mjs --protocol bench/protocol.json --out /tmp/trail-followup.93DyJO/lead-local
# Same command again: exit 2, before/after bytes asserted unchanged.
node bench/local.mjs --protocol bench/protocol.json \
  --out /tmp/trail-followup.93DyJO/lead-fault-ID --fault ID
```

The last invocation ran for every ID below in a separate fresh directory.
Happy run exited 0: all 18 arms / 72 task verdicts passed; 209 HTTP
requests including the negative controls. Before/after links matched.
Every injected fault exited 2 and failed its first arm, with clean server
shutdown and no remaining sockets or pending requests.

| Fault ID | Observed first-arm failure |
| --- | --- |
| too_many_calls | budget_exceeded |
| oversized_response | response_too_large |
| never_answers | deadline_exceeded |
| unknown_usage | usage_unknown |
| token_ceiling | token_ceiling_stop |
| malformed_answer | malformed_response |
| wrong_answer | wrong_answer |
| missing_source | missing_source |
| fabricated_quote | quote_not_in_source |
| unfetched_source | source_not_fetched |
| decoy_quote | quote_missing_value |
| wrong_source_page | wrong_source_page |
| whole_body_quote | quote_too_broad |

Normal arm counts: cold six navigation arms / 72 calls; trail-on six
synthetic-shortcut arms / 24 calls; trail-off six navigation arms / 72
calls. These counts are scripted harness behavior, NOT measured Trail
advantage. Token telemetry is synthetic, not paid-model usage.

Captured hashes:
- Protocol: `7d067f26bfdef3972f4be8312c4dfa541320acadc081969f47f8cdbc21144191`
- Runner: `9726902e16c51bebac69d3f32715028e8a35f416dfc942f84b769d816bfaa9f8`
- Oracle: `078b9a46a4ecac1344447fbf263dec57c5c5c74e5a76b51c34bac74007cc88b9`
- Before: `e965fb9ace6a7c8021b78d51c75616902d488fb9acc0743b76cb20f8b7a04121`
- After: `ee41d8ccdaf5d1e8ffc1e944097f4afd8cd8a8894987cb0c71c04b8385217057`

The lead's previously failing oracle counterexample now returned
`pass:false` for truth `2024` and fetched `Summary: year=20240`;
the exact `Summary: year=2024` returned true in the same assertion script.
No assumption from the worker's PASS was used.

Cleanup: generated happy and all 13 fault output directories removed,
absence checks returned `LOCAL_LEAD_QA_CLEANUP_OK`, exit 0. Server receipts:
closed true, pending 0, sockets 0, one observed hang aborted, no cache
files, deadline timers cleared. Parent root remains for remaining work.
