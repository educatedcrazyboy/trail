# Follow-up: lifecycle handling and pinned manifest verification

Changed files: `bench/prepare.mjs`, `test/prepare.test.mjs` (no fixtures added; lifecycle rows are appended to the existing sanitized fixture inside tests). No commits, no provider/Aside execution, no profile writes.

## Observed lifecycle shape
Read narrowly (keys/role/event only) from the real Aside session: first and last rows are `{role:"turn-lifecycle", event:"started"|"finished", turnId, timestamp}`; the final physical row is `finished` with the same `turnId` as `started`, directly after the assistant row with `stopReason: stop`. No prompt/answer text was copied anywhere.

## Lifecycle acceptance (`completedAnswer`)
- Last row not lifecycle: unchanged behavior (existing completion checks).
- Last row lifecycle: must have exactly keys `event,role,timestamp,turnId`, `event === "finished"`, non-empty string `turnId`; the latest `started` row (if any) must carry the same `turnId` with no other lifecycle rows between; the row before it is then subjected to the unchanged completed-assistant checks (text, no tool calls, stop/end_turn).
- Rejected (tested): different turn id, extra `status`/`error` field, `aborted`/unknown event, missing turnId, unknown role, malformed JSON, trailing `started`, finished+started (unfinished later turn), duplicate finished, started+finished with no answer.

## Pinned verification
- `prepare` and `verify` results now include `manifestSha256` (sha256 of exact raw `manifest.json` bytes), `pinned`, `authenticity`.
- `verify <dir> --expected-manifest-sha256 <64 lowercase hex>` (API: `verify(dir, {expectedManifestSha256})`). The pin is compared to the raw bytes BEFORE JSON parsing or any other manifest trust; malformed pin is rejected.
- Unpinned verify is local-internal integrity ONLY (`authenticity: local-internal-integrity-only`); all results keep `liveAllowed: false`.
- **The pin must be recorded and held OUTSIDE the editable bundle** (e.g. copied from the `prepare` output into a separate trusted record). A pin stored inside the bundle gives no protection.

## Evidence
- `node --test test/prepare.test.mjs`: 17 tests, 17 pass, 0 fail (the 14 pre-existing tests in this file unchanged plus 3 new; the unconditional live gate is untouched — I did not find a count of 44 in this file, so the 44 likely spans other test files, which I did not run).
- Actual CLI (temp root, fixture + appended `finished` row, `t1`):
  - `prepare` exit 0, returned `manifestSha256`.
  - `verify --expected-manifest-sha256 <original pin>`: PASS, `pinned: true`.
  - wrong pin (`aaaa...`): FAIL "manifest does not match the externally pinned sha256", `liveAllowed:false`.
  - Coherent replacement (frozen skill, both trail-on arm copies, inventories, hashes and manifest rewritten): unpinned verify PASS (`local-internal-integrity-only`); pinned with original pin FAIL.
  - Exit 2 for failing CLI verify is asserted in the test suite via `execFile` (`e.code === 2`); my shell demo's printed "exit=0" values for failing lines came from `head`/`grep` pipe status, not the CLI, and are not evidence.
- Ordinary tamper (extra file) rejected, covered in the new test.
- Cleanup: temp root removed; `ls` reported "No such file or directory" (ENOENT). TMPDIR, NODE_COMPILE_CACHE and BUN cache were all pointed inside it.

## Not done / notes
- Pin is only as trustworthy as its out-of-band storage; no signatures (by design).
- `docs/audit/fairness-verdict.md` shows as untracked in git; it predates and is unrelated to this work.
