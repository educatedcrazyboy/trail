# Muse 벤치마크 최종 보고 (2026-10-13)

모델: `openrouter/meta/muse-spark-1.3-contributor`, effort `off`.
4태스크 × cold / trail-on / trail-off, 기존 공정 규칙(forget-before-off, 동일 warm-up, distill-after-on) 준수.

## 최종 집계 (최신 유효 런)

| 태스크 | cold | trail-on | trail-off | strict-beat |
|---|---|---|---|---|
| coupang-tracking (r7) | 23st / 63.1k / 109s | 9st / 59.0k / 63s | 14st / 61.9k / 57s | FAIL — steps·tokens 승, wall 6s 패 |
| naver-blog-stats (r5) | 23st / 59.1k / 66s | 9st / 48.1k / 15s | 18st / 69.8k / 105s | **PASS** |
| youtube-top-video (r5) | 3st / 44.2k / 21s | 3st / 46.3k / 11s | 3st / 44.0k / 10s | FAIL — steps 동률, wall 노이즈 |
| google-scholar-paper (r5) | 3st / 41.7k / 8s | 3st / 44.6k / 13s | 4st / 42.8k / 22s | FAIL — steps·wall cold에 패 |

**합격 1/4 — 3/4 기준 미달.**

## 적용한 개선 (src/)

| 커밋 | 내용 | 효과 |
|---|---|---|
| f070fae | doneCheck에 `replCalls>0` 요구 | 0호출 오판 방지 |
| 1cb11f4 | skipThin: 재사용 불가 스킬 자동 삭제 | 스텁 읽기 비용 제거 |
| e25369c | 스킬 STEP을 단일 복합 repl 호출로 | 호출당 레이턴시 절감 |
| f9e0d48 | MEMORY.md 인덱스에 루트 목적지 체인(`also:`) | muse가 SKILL.md를 안 읽어도 목적지 노출 |
| 16e491b | `{x}` 템플릿에 "fill {} then open" 인라인 지시 | URL 치환 유도 |

테스트: `node --test` 13/13 그린 유지 (test/core 11 + test/e2e 2).

## 결핍 명명 — 왜 strict-beat가 안 되는가

1. **바닥 태스크(youtube, scholar)**: warm-up 탭 1 + 답 호출 1 + 정리 1 = 3스텝이 최소. muse의 내장 지식(`results?search_query=`, `/scholar`)이 이미 최적 경로라 스킬이 줄일 것이 없고, wall ±수초는 호출당 레이턴시 노이즈다. strict-beat는 설계상 이 규모에서 불가능.
2. **coupang 구조적 한계**: 배송조회 페이지 `shiptrack?orderId=&shipmentBoxId=&invoiceNumber=`가 3개 런타임 쿼리를 요구 — 어느 메모리 형태로도 미리 계산 불가. 진입은 클릭뿐이라 인덱스 개선(9스텝 달성)에도 wall을 trail-off에 6초 진다.
3. **모델 행동(src 통제 불가)**: trail-on이 MEMORY.md 인덱스만 읽고 SKILL.md를 전혀 안 연다(read_file 0회) — aside 측 주입 문제. r6에서는 "Node is not an Element" 클릭 루프 126호출로 출력 한도 초과. 40호출 예산 문구는 조언일 뿐 강제가 아니다.

## 결론

trail-on의 이득은 진짜다 — naver에서 cold 대비 스텝 -61%, wall -77%, 토큰 -19%. 하지만 "3축 모두 strict-beat"는 두 가지 이유로 이 스위트에선 도달 불가: (a) 바닥 태스크에서 더 줄일 스텝이 없고, (b) wall이 호출당 레이턴시에 지배돼 스킬의 스텝 절감이 ±수초 노이즈 아래로 묻힌다.

실질 가치는 "멀티홉 탐색 태스크(naver 계열)에서 스텝과 토큰을 크게 줄인다"로 요약할 수 있다.
