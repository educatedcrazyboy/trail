# Fairness patch notepad

## Recovery and tier
2026-10-14: HEAVY. Measurement integrity and explicit rigorous requirements.
Previous temporary notepad was empty. No patch existed at recovery.
Run root already allocated: /var/folders/m6/xsqcdfwn7618yqjqh1np5q200000gn/T/tmp.GVVHpDUXTj.
Do not touch pre-existing ulw-loop ledger changes or audit artifacts.

## Ideal end state
No benchmark model request is permitted merely because exact-host files
are absent. Unknown browser isolation or independent memory channels must
fail closed. Rotation mitigates order effects; it cannot certify isolation.
Never clear or clone the user's main browser profile.

## Skills and topology
mass-ulw and its planning reference were read in this conversation.
Use one implementation producer for bench measurement, CLI and tests,
then an independent verifier consuming its evidence. Lead owns the
fairness policy, documentation, actual artifact inspection and final QA.
No ulw-plan was requested, so no plan-reviewer gate applies.

## Plan
1. Implement checked commands, honest measurements, parser and tests.
2. Add fail-closed environment readiness policy before any provider call.
3. Independently verify the producer and test adversarial missing evidence.
4. Run repository tests and real historical-session measurement locally.
5. Inspect diff, record limitations, commit verified increments.
6. Clean owned temporary resources with receipts.

## Success criteria and QA
- Historical AZ3Kp7OZDrDpdAi7: 126 total calls, 84 repl, done false.
- CLI no arguments: usage, nonzero exit, no provider request.
- CLI live invocation without proven isolation: nonzero exit before provider.
- Dirty, absent or unsupported environment evidence: refusal before execution.
- node --test: existing tests and new bench regression tests green.
- No claim that exact-host cleanup or rotation proves full isolation.
- A paid benchmark is forbidden until environment evidence passes.

## Now
Implement the benchmark measurement and preflight gate.

## Findings
The previous goal's proposed clean=true smoke test was insufficient:
it would repeat the original fairness failure. The user's fairness-first
invariant takes precedence over that narrower success criterion.

## Resources
Owned run root above; remove at end. No new browser or provider session started.

## Lead verification, 2026-10-14
Read bench/bench.mjs, bench/measure.mjs and test/bench.test.mjs in full.
Read producer and independent verifier artifacts. Both explicitly identify
this as partial, not runnable isolation. Existing core read output was
truncated; no claim of full core source review.

Ran node --check bench/bench.mjs and bench/measure.mjs, then
node --test test/core.test.mjs test/e2e.test.mjs test/bench.test.mjs.
Monitor mon_8XJRYJTHV1CBRMBH: exit 0, 21 tests, 21 pass, 0 fail.
All commands used TMPDIR=/tmp/trail-fairness-lead.CqXLRN and task-owned
NODE_COMPILE_CACHE and BUN_RUNTIME_TRANSPILER_CACHE_PATH children.

Direct CLI no-argument and youtube --only=trail-off probes both returned
exit 2, empty stdout, respectively usage and FAIRNESS-FIRST stderr.
Historical CLI measurement independently asserted 126 tools, 84 repl,
done false, stopReason length. Recorded usage sum 10,904,881 versus
maximum 262,175, including 10,639,744 cache-read tokens. This corrects
earlier cumulative-token interpretations, not billed-cost accounting.
git diff --check passed. LSP was unavailable to producer (missing server);
syntax checks and runtime tests are the available validation.

## Current gap and question
Live execution was removed, NOT isolated. No watcher normalization,
environment precheck, counterbalanced frozen-training execution or true
browser/account isolation has been implemented. Goal remains OPEN.
Aside guide and settings help expose profile selection but no documented
CLI controls for account-memory isolation. This is not proof that the app
or other integrations lack such controls.
Asked whether to retain Aside or use a dedicated executor via required,
nonblocking question isolation_backend. No paid benchmark requested.

## Now
Checkpoint verified safety milestone; investigate chosen isolation backend
after user's answer. Do not call the full Fairness Patch complete.

## User decision and next track
User answered "Aside 유지". Keep Aside as executor; do not substitute
a custom browser/model loop and compare it as if it were the old system.
Read-only discovery child st_01a1388c owns .omo/aside-isolation-discovery.md.
No provider calls or profile mutations authorized to that child.
Independent verifier PASS covers refusal and measurements only.
Self-review: HEAVY remains appropriate; actual isolation is unresolved.

## Cleanup receipt
Lead command returned exit 0 with LEAD_CLEANUP_OK and
BOOTSTRAP_CLEANUP_OK. /tmp/trail-fairness-lead.CqXLRN and the empty
bootstrap tmp.GVVHpDUXTj directory are absent. Producer/verifier own
temporary cleanup receipts are in their respective reports.
