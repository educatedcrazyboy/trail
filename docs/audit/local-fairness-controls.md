# 로컬 공정성 통제 구성 결과 — 2026-10-15

## 판정

**로컬 준비 환경은 구현·검증했다. Aside 런타임 격리는 미검증이며 실벤치는 차단한다.**
이 둘을 구분해야 한다. 생성한 디렉토리는 실제 Aside 프로필이나 로그인된
브라우저 컨텍스트가 아니다. 이를 실행 계정으로 연결했다는 주장도 하지 않는다.

## 확보한 통제

| 항목 | 실제 동작 | 한계 |
| --- | --- | --- |
| 동결 학습 입력 | 완료된 합성 학습 로그에서 기존 Trail core로 경로 처치를 한 번 증류, hash 기록 | 의미적 과업 성공·학습 출처의 진실성까지 증명하지 않음 |
| 동일한 시작 파일 | cold/off는 빈 계정 트리, on은 같은 동결 처치의 독립 복사본 | 브라우저 및 서버 측 상태를 초기화한 것이 아님 |
| 균형 실행 계획 | 6순열, 18개 계정 준비. 각 조건은 각 위치에 두 번 배치 | 계획만 생성하며 실행·시간 비교는 안 함 |
| 무결성 검사 | 변조·추가·삭제 파일, symlink/hardlink, 경로 이탈, 임의 allowlist와 live flag 거부 | hash는 서명이 아니며 전체 번들의 일관된 교체를 인증하지 못함 |
| 실제 모델 출처 | 모든 assistant 응답의 top-level provider/model을 기록하고 기대값 불일치·결손 거부 | 로그의 진위·provider 라우팅·effort는 증명하지 못함 |
| 비용 방어 | 라이브 실행은 모델 요청·사용자 상태 변경 전에 거부 | 실벤치 실행 기능은 여전히 사용 불가 |

## 로컬 준비 재현

기존 출력 경로를 재사용하지 않는다. 아래 모델은 로컬 fixture label이며
어떤 provider 호출도 발생하지 않는다.

```sh
R=$(mktemp -d /tmp/trail-preparation.XXXXXX)
export TMPDIR="$R"
export NODE_COMPILE_CACHE="$R/node-cache"
export BUN_RUNTIME_TRANSPILER_CACHE_PATH="$R/bun-cache"
node bench/prepare.mjs --help
node bench/prepare.mjs prepare \
  --training-session test/fixtures/run1.messages.jsonl \
  --model fixture/local-model --effort high --out "$R/prepared"
node bench/prepare.mjs verify "$R/prepared"
# 확인한 뒤 본인이 만든 R만 정리한다.
rm -r "$R"
```

검증된 실제 실행 경로는 `/tmp/trail-controls.dbpf1i/lead-prepared`였다.
생성·verify 모두 exit 0, arms 18, 동일 frozen hash
`56a887ffac5cb096b7c8cc8f85cce66455a3cb981796ddd40be0b1d604e377a9`를 반환했다.
출력 루트에 추가 파일을 만든 뒤 verify는 exit 2로 거부했다.
매 준비의 생성 시각 때문에 서로 다른 준비 간 hash는 달라질 수 있다.
한 준비 안의 모든 on arm이 같은 처치를 받는 것이 계약이다.

## 모델 출처 검증 재현

```sh
node bench/bench.mjs \
  --measure-session "$HOME/.aside/u/0/sessions/2026-10-13_vjVvZC2H5GW7OeDN/messages.jsonl" \
  --task bench/tasks/youtube-top-video.json \
  --expected-model z-ai/glm-5.3-flash-ultrafast --expected-provider opengateway
```

실제 실행은 assistant 4개 모두 동일 GLM identity를 관측했고 위 기대값은
exit 0, verified true였다. Muse 기대값으로 바꾸면 exit 2, verified false다.
기대값이 없을 때는 verified null로 관측만 보고한다.
`-m`은 더 이상 무시하지 않으며 라이브 모드에서만 `--model` 별칭으로 처리한다.

## 반증과 교정

독립 감사는 처음에 **FAIL**이었다. provider 또는 model 중 한쪽만 있는
로그가 기대값 검사에서 verified true가 되는 반례를 찾았다.
새 회귀 테스트는 수정 전 실제로 실패했다
(`partial or nested-only identities cannot satisfy provenance expectations`,
true !== false, exit 1). 이를 수정해 전체 identity 결손은 항상 거부한다.
중첩 metadata에서 실제 모델을 추측하던 탐색도 제거했다.

독립 감사 보고서는 `.omo/g005-verify.md`에 실패 기록 그대로 남긴다.
수정 후 검증은 리드가 직접 수행했다. 후속 DAG는 provider 연결 오류로
실패했다. 이후 별도로 수행한 최종 독립 리뷰는 코드를 읽고 전체 44개 테스트와
실제 CLI를 재실행해 C001-C003 APPROVE를 기록했다.
보고서는 `.omo/g005-final-review.md`에 보존한다.

## 검증 결과

```sh
node --check bench/prepare.mjs
node --check bench/measure.mjs
node --check bench/bench.mjs
node --test test/core.test.mjs test/e2e.test.mjs test/bench.test.mjs test/prepare.test.mjs
```

44개 PASS, 0 FAIL, exit 0. 직접 실행한 CLI의 정상 준비·변조 거부,
GLM 일치·Muse 불일치, 라이브 거부도 각각 기대 exit 0/2를 확인했다.
누락 identity와 중첩 metadata의 실제 CLI 거부는 신규 회귀 테스트가 검증한다.
LSP 서버는 설치되어 있지 않아 진단을 실행하지 못했고, Node 구문·실행 검증을 사용했다.

리드가 만든 QA 번들은 검증 후 제거했으며 종료값 0과
`LEAD_BUNDLE_CLEANUP_OK`를 확인했다. 실행용 계정으로 남겨두지 않았다.

## 아직 통제하지 못하는 영역

Aside의 독립 브라우저 수명·인증 동등성, 기존 memory_search/자동 주입,
background memory writes, 실제 런타임 skill inventory와 watcher,
서버 측 요청 이력·네트워크 조건은 입증하지 못했다.
따라서 새 성능 점수나 Trail의 우월성 결론은 없다.
`docs/audit/aside-isolation-requirements.md`의 지원 인터페이스를 확보하고
실제 통합 검증이 통과하기 전에는 실벤치를 열지 않는다.
