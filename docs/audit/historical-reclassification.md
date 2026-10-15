# Historical benchmark reliability correction

Date: 2026-10-15. This is a correction, not a new benchmark.
Machine-readable append-only correction ledger:
`docs/audit/historical-corrections.jsonl`.
Original results and the old loop ledger are preserved; their historical
success statuses are not current endorsements.

| Evidence class | Current classification | Permitted use |
| --- | --- | --- |
| All archived `docs/benchmarks/*.json` comparisons | Isolation not established; ineligible for causal/fairness conclusions | Descriptive historical observations, with metric caveats |
| Latest r5/r7 comparisons and r6 failure formerly called Muse | Requested-model claim contradicted by logged final GLM identity | Study model-selection bug and observed execution, not Muse performance |
| Old `tokens` | Largest single recorded request, not cumulative usage | Request-context sizing only |
| Old `replCalls` | REPL count, not total tool calls | REPL-specific behavior only |
| Old `done:true` | Keyword heuristic, not verified semantic success | Locate candidate outputs for reinspection |
| r6 on output-limit termination | Incomplete execution, not successful completion | Failure/budget analysis |
| Old Naver G002 success status | Historical claim retracted as fair-advantage evidence | Audit trail only |

The model contradiction is scoped to the 13 final assistant messages
documented in `offline-muse-remeasurement.md`. It must not be generalized
to every older session: those need their own observed identities.
No absence of explicit memory reads establishes absence of automatic
memory injection. No new local mock result repairs an old experiment.

## Technical explanation

The old experiment did not exclude important confounders, its requested
model was not reliably forwarded, and several reported metrics had
different semantics from their labels. Correcting arithmetic does not
retroactively establish the missing controls. A coherent causal comparison
requires equal starting state and a verified difference in only the
intended treatment.

## 쉬운 설명

예전 성적표는 지우지 않고 보관하지만, 공정한 시험 결과로 인정하지 않습니다.
시험장과 참고자료가 같았는지 확인되지 않았고, 일부 시험은 이름표에 적힌
모델과 실제 응시 모델도 달랐습니다. 토큰 숫자도 총사용량이 아니라 한 번의
요청에서 가장 큰 값이었습니다. 숫자를 다시 계산하더라도 당시 시험 조건까지
되돌려 고칠 수는 없습니다.
