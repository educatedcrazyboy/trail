# MODEL 계약 — 실제 provider/model 출처 감사 (g005, 2026-10-15)

기존 재계측(`docs/audit/offline-muse-remeasurement.md`)에 실제 provider/model
출처 감사를 추가했다. 모델 요청 0회, 사용자 상태 기록 0회, 커밋 0회.
변경 파일은 `bench/measure.mjs`, `bench/bench.mjs`, `test/bench.test.mjs`,
이 문서뿐이다. 라이브 벤치의 무조건적 거부(FAIRNESS-FIRST)는 그대로 유지된다.

## 측정 계약 (`bench/measure.mjs`, schemaVersion 3)

- 대상은 **모든 assistant 응답 메시지**다. 최종 메시지만 보는 방식은
  중간 요청의 모델 혼재를 놓친다.
- identity는 세션 로그가 메시지에 **실제로 기록한** provider/model 문자열에서만
  가져온다. 로그 필드 위치는 `sources`에 기록한다(예: `message.model`,
  `message.provider`). 요청한 라우트 별칭·명령줄 옵션에서 모델을 추정하지 않다.
- `identities`: 관측된 `provider/model` 의 정렬된 고유 목록. 한쪽만 기록된
  경우 결손 쪽을 `unknown`으로 둔다(예: `unknown/z-ai/glm-5.3-flash-ultrafast`).
  모델 ID가 아예 없으면 identity를 만들 수 없다.
- 플래그:
  - `consistent`: assistant 메시지 ≥ 1, 전 메시지가 provider·model 모두 기록,
    그리고 identity가 정확히 1종.
  - `mixed`: 서로 다른 identity가 2종 이상.
  - `missing`: identity가 불완전한 assistant 메시지가 1개 이상이거나 assistant
    메시지가 0개. **missing은 unknown이지 성공이 아니다.**
- 기대값이 없으면 `expectation: null`, `verified: null` — 관측만 보고하며
  "요청한 모델이 실행됐다"를 절대 주장하지 않는다.
- reasoning effort는 계약 밖이다. 반드시 로그에 남지 않으므로 아무 값도
  단정하지 않고, 결손은 미상으로 남는다. effort는 플래그·기대값 검증에
  영향을 주지 않는다.

## 기대값 검증 (`bench/bench.mjs` 읽기 전용 옵션)

- `--expected-model <모델 ID>`: 로그에 기록된 실제 모델 ID와 **바이트 단위
  정확 일치**해야 한다. 별칭 해석·정규화·접두사 매칭이 없다. 예:
  `muse`는 `openrouter/meta/muse-spark-1.3-contributor`와 매칭되지 않고,
  대소문자가 다르면 거부된다.
- `--expected-provider <제공자>`: 선택 사항. 같은 정확 일치 규칙.
- 기대값이 주어졌는데 하나라도 불일치하거나 메타데이터가 결손이면
  **거부**한다: 종료값 2, stderr에 메시지 번호별 문제 목록, stdout에도
  관측 리포트(`verified: false`)를 남긴다. 절대 오탈자로 통과하지 않는다.
  assistant 메시지가 0개여도 거부다.
- `-m`은 `--model`의 별칭으로 정규화하거나 명시적으로 거부한다. 절대
  무시하지 않는다. `-m`/`--model`은 라이브 옵션이므로 읽기 전용 모드에서
  쓰면 "read-only measurement cannot use live benchmark options"로 거부되고,
  값이 없거나 `-`로 시작하면 오류다. 라이브/읽기 전용 옵션 분리 유지.
- 기대값 옵션은 읽기 전용 측정에서만 의미가 있다. 라이브 호출은 어떤
  옵션이 붙어도 그 전에 FAIRNESS-FIRST 거부된다.

## 검증 실행 (전부 읽기 전용, 프로바이더 호출 없음)

회귀: `node --test test/core.test.mjs test/e2e.test.mjs test/bench.test.mjs`
→ 29 pass / 0 fail, 종료값 0 (bench 16개 포함: consistent·mixed·missing·
기대값 불일치·CLI historical/fixture·`-m` 별칭/오형).

실제 YouTube 세션 `2026-10-13_vjVvZC2H5GW7OeDN`
(`bench/tasks/youtube-top-video.json`, assistant 메시지 4개):

| 실행 | 결과 |
| --- | --- |
| 무기대 측정 | `identities: ["opengateway/z-ai/glm-5.3-flash-ultrafast"]`, `flags: consistent/mixed/missing = true/false/false`, `verified: null`, 종료값 0 |
| `--expected-model openrouter/meta/muse-spark-1.3-contributor` | **거부**, 종료값 2. 메시지 4/6/8/10 모두 `logged model "z-ai/glm-5.3-flash-ultrafast" != expected ...` |
| `--expected-model z-ai/glm-5.3-flash-ultrafast --expected-provider opengateway` | `verified: true`, 종료값 0 |

무기대 측정에서 4개 assistant 메시지(물리적 줄 4/6/8/10) 전부가
`opengateway/z-ai/glm-5.3-flash-ultrafast`를 기록한다. 즉 이 세션에서
GLM은 최종 메시지뿐 아니라 **모든** 응답의 모델이고, Muse 기대값은
거부된다. 기존 재계측의 "최종 assistant만 확인" 한계가 좁혀진 부분이다.

재현:

```sh
node bench/bench.mjs \
  --measure-session "$HOME/.aside/u/0/sessions/2026-10-13_vjVvZC2H5GW7OeDN/messages.jsonl" \
  --task bench/tasks/youtube-top-video.json
# + --expected-model openrouter/meta/muse-spark-1.3-contributor  → exit 2
# + --expected-model z-ai/glm-5.3-flash-ultrafast --expected-provider opengateway → exit 0
node --test test/bench.test.mjs
```

## 해석 제한

- 이 감사는 **로그에 기록된 메타데이터**를 읽는 것만 증명한다. 로그 파일의
  무결성·타임스탬프는 보장하지 않으며, 세션이 손상·조작됐으면 결과도
  따라간다. provider가 무언가를 로그했다는 사실과 로그 내용이 참이라는
  사실은 다르다.
- 기대값 검증은 "요청한 모델이 실행됐다"가 아니라 "로그가 남긴 모델 ID가
  기대값과 같다"를 검증한다. 모델 라우팅·fallback 여부와 이유는 이 로그만으로
  알 수 없다. `--expected-model`은 라우트 별칭을 해석하지 않는다.
- 다른 12개 최신 비교 세션과 r6 세션의 전수 재검증은 이번 범위 밖이다.
  기존 재계측의 해당 주장은 "최종 메시지 기준"으로만 유효하다.
- reasoning effort는 미상으로 유지한다. 이 보고의 어느 항목도 effort를
  단정하지 않는다.
- 이 세션의 `done: false`는 최종 제목 `GANGNAM`과 검사 문자열 `Gangnam`의
  대소문자 차이에서 나온 키워드 휴리스틱 오탐이다(재계측 문서 참조).
  실제 과업 실패로 단정하지 않는다.
- 공정성 판정은 바뀌지 않았다: `fairness.valid`는 여전히 false, 브라우저/계정
  메모리 격리 미증명, 자동 주입 미배제. 모델 출처 감사가 격리 부재를
  회복하지 못하며, 라이브 거부는 유지된다. 이 리포트는 공정한 재벤치가
  아니다.
- 임시 작업 루트(`/tmp/trail-g005-*`)와 테스트 임시 디렉터리는 정리 완료.

## Lead correction after independent FAIL

The independent audit `.omo/g005-verify.md` found that a missing provider
with expected model, or missing model with expected provider, could pass.
A new real-CLI regression failed before the fix (`true !== false`, exit 1).
The lead now rejects ANY incomplete provider/model pair whenever an
expectation is supplied. The speculative recursive metadata extraction
described earlier was removed: ONLY top-level `message.model` and
`message.provider` are accepted; unsupported/nested-only layouts stay unknown.
The added regression covers both partial identities and nested-only metadata
using the actual CLI, expecting exit 2 and verified false in all cases.

Lead post-fix full suite: 44 pass, 0 fail, exit 0, monitor
mon_TVQ34XKXRBRF5DVY. Lead historical CLI: all four YouTube responses observed
GLM; exact GLM/provider expected exit 0; Muse expected exit 2; live invocation
exit 2 with FAIRNESS-FIRST. This supersedes the earlier 29-test tally and
broader metadata-field claims, not the preserved initial audit failure.
