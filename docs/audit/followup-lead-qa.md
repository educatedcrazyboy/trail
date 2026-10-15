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
