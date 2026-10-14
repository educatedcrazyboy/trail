# 기존 'Muse' 보고 세션 재계측 — 2026-10-14

모델 요청 없이 기존 세션 13개만 읽었다. 최신 비교 12개(r5의 Naver,
YouTube, Scholar와 r7의 Coupang), 별도로 r6 실패 세션 1개다.
이는 공정한 재벤치가 아니며 원래 실행의 격리 부재를 복구하지 못한다.
모든 결과의 `fairness.valid`는 false, `contamination.clean`은 null이다.
명시적 기억 접근이 검출되지 않았다는 것이 자동 주입 부재의 증거는 아니다.

## 정정된 사용량

합계는 로그의 assistant usage 기록을 합산한 처리 토큰이다.
캐시 읽기를 포함하고 같은 컨텍스트가 요청마다 반복 집계되므로 청구 비용과
같지 않다. 기존 표의 tokens는 세션 누적량이 아니라 최대 단일 요청량이었다.

| 과업 | arm | 전체 호출 | REPL | 기록 사용량 합계 | 캐시 읽기 합계 | 최대 단일 요청 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Coupang r7 | cold | 23 | 23 | 1,202,314 | 1,145,536 | 63,126 |
| Coupang r7 | on | 9 | 9 | 492,189 | 441,088 | 58,962 |
| Coupang r7 | off | 14 | 14 | 726,055 | 671,232 | 61,944 |
| Naver r5 | cold | 23 | 23 | 1,215,675 | 1,163,136 | 59,053 |
| Naver r5 | on | 9 | 9 | 436,041 | 395,904 | 48,054 |
| Naver r5 | off | 18 | 18 | 1,030,786 | 967,808 | 69,795 |
| YouTube r5 | cold | 3 | 3 | 163,819 | 128,000 | 44,222 |
| YouTube r5 | on | 3 | 3 | 172,261 | 134,400 | 46,298 |
| YouTube r5 | off | 3 | 3 | 163,388 | 127,872 | 44,048 |
| Scholar r5 | cold | 3 | 3 | 158,714 | 125,504 | 41,689 |
| Scholar r5 | on | 3 | 3 | 169,336 | 133,184 | 44,633 |
| Scholar r5 | off | 4 | 4 | 199,453 | 165,120 | 42,763 |
| Coupang r6 | on | 126 | 84 | 10,904,881 | 10,639,744 | 262,175 |

집계 대상과 실행 근거는 `.omo/fairness-patch-notepad.md`에 기록했다.

## 재현

```sh
node bench/bench.mjs \
  --measure-session "$HOME/.aside/u/0/sessions/2026-10-13_AZ3Kp7OZDrDpdAi7/messages.jsonl" \
  --task bench/tasks/coupang-tracking.json

node --check bench/bench.mjs
node --check bench/measure.mjs
node --test test/core.test.mjs test/e2e.test.mjs test/bench.test.mjs
```

최종 회귀: 21개 PASS, 0 FAIL, 종료값 0
(`mon_BMMBJNQB87CN3QCR`, 496.228 ms).

## 해석 제한

- r6 on은 `stopReason:length`이며 완료된 답변이 아니었다.
- 새 done 검사도 최종 답변 문자열을 확인하는 휴리스틱이지 의미적 정답 검증이 아니다.
- 최대 토큰값을 누적량으로 해석한 이전 사용량 보고는 정정해야 한다.
- 기존 실행의 wall time은 재계산하지 않았다. 로컬 파일 처리 시간으로
  과거 모델 실행 시간을 대신하지 않는다.
- 이 표로 Trail의 인과적 효과나 3/4 strict-beat를 판정하지 않는다.

## 최종 답변 수동 대조

Coupang r7 on은 택배사와 송장번호를 실제 최종 답변에 기재했다.
다만 검사 목록의 `운송장` 대신 `송장번호`를 써서 새 키워드 검사에서 false다.
YouTube 세 실행도 제목·채널·조회수를 기재했지만 최종 제목의 `GANGNAM`이
검사 문자열 `Gangnam`과 대소문자가 달라 false다. 이 네 건을 실제 과업 실패로
단정하지 않는다. 문자열 검사만으로 의미적 완료를 증명하지 못한다는 추가 증거다.
반면 r6 on은 출력 한도에 도달한 실패로 별도 취급한다.

## 실제 모델 식별 불일치

최신 비교 12개 실행 모두의 최종 assistant 기록에서 확인한 실제 provider/model은
`opengateway / z-ai/glm-5.3-flash-ultrafast`다. 이전 Muse 모델 고정 보고와
일치하지 않는다. 요청 모델과 실제 실행 모델을 모두 기록하고 일치 여부를
검증해야 한다. 파일 이름이나 실행 명령 설명만으로 모델 고정을 증명하면 안 된다.

직접 확인한 물리적 JSONL 줄: Coupang cold/on/off = 49/22/31,
Naver = 49/22/39, YouTube = 10/10/10, Scholar = 10/10/12.
세션 ID는 각각 원래 최신 비교 JSON의 세션 ID를 사용했다.

r6 on도 최종 assistant 메타데이터를 스트리밍 파싱해 같은 provider/model과
`stopReason:length`를 확인했다. 총 13개 최종 assistant가 동일한 GLM 모델을
기록한다. 모든 중간 요청의 모델 일관성까지 전수 확인한 주장은 아니다.

원인 코드도 확인했다. `git show f2461fa:bench/bench.mjs`의 옵션 파서는
`process.argv.includes("--model")`만 처리하고 `-m`은 처리하지 않는다.
그런데 이 대화에 기록된 r6/r7 실행 명령은 하네스에 `-m openrouter/meta/...`를
전달했다. 따라서 해당 실행 경로에서 model은 null이고, 자식 `aside exec`에
모델 옵션이 전달되지 않는다. 기본 모델에 맡겨지는 결함이다. 이것이 적어도
그 실행 명령에서 Muse 고정이 적용되지 않은 원인이다.

현재 안전 차단 CLI는 알 수 없는 플래그로 실벤치를 실행하지 않는다.
하지만 실제 모델 ID 검증·고정이 구현된 것은 아니므로, 실벤치 재개 전 MODEL
계약 검증이 여전히 필요하다.
