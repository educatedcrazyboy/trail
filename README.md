# Trail

**Aside 브라우징 에이전트가 한 번 사용한 웹사이트의 사용법을 자동으로 기억하고,
다음 작업에서 스스로 활용하게 하는 로컬 도구.**

"쿠팡에서 섬유유연제 주문해줘", "인스타그램에서 민수에게 메시지 보내줘" —
Aside는 똑같은 사이트에서도 매번 화면을 읽고, 버튼을 찾고, 같은 경로를 다시
탐색한다. Trail은 그 탐색 과정을 조용히 기록했다가, 다음 비슷한 작업에서
이미 배운 경로를 Aside에 건네준다. 사용자가 "기록해줘", "기억 불러와줘"라고
말할 필요는 없다.

## 어떻게 동작하나

1. `trail init` 한 번으로 설치하면, Aside 계정에 "trail" 컨트롤러 스킬이
   설치되고 세션 감시가 준비된다.
2. 평소처럼 Aside에 작업을 시킨다. 작업이 끝나면 Trail이 세션 기록에서
   **사이트 구조와 작업 절차**만 추려 사이트별 메모리(`~/.trail`)에 저장한다.
3. 저장된 경험은 두 갈래로 Aside에 돌려준다: 사이트별 스킬
   (`skills/user/trail-<사이트>/`)과, Aside가 매 작업마다 읽는
   `memory/MEMORY.md` 맨 앞의 학습 사이트 색인(마커 구간으로 관리,
   검증된 바로가기를 인라인 표시). 다음에 같은 사이트 작업을 시키면
   Aside가 그 색인을 보고 바로가기 경로로 바로 이동한다.
4. 사이트가 바뀌어 저장된 경로가 안 맞으면 Aside는 현재 화면을 다시
   확인해 새 경로를 찾고(실험에서 "shortcut doesn't match; explore
   normally"라고 판단 후 정상 탐색 확인), 다음 수집 때 Trail이 그 교정을
   메모리와 색인에 반영한다.

## 설치

요구 사항: Node.js 18+, Aside 데스크톱 설치(세션이 `~/.aside/u/0/sessions`에
저장되는 상태).

```sh
git clone <repo-url> trail
cd trail
node bin/trail.js init
```

`init`이 하는 일: `~/.trail` 생성, 설정 저장, Aside에 `trail` 컨트롤러
스킬 설치. 그 이후 평소처럼 Aside를 쓰면 된다.

백그라운드 수집까지 켜고 싶다면:

```sh
node bin/trail.js watch &      # 세션 폴더를 주기적으로 스캔
# 또는 작업 후 수동으로:
node bin/trail.js watch --once
```

## 일상적인 사용

별도의 명령이 필요 없다. 그래도 기억을 살펴보고 싶을 때:

```sh
node bin/trail.js list                  # 배운 사이트 목록
node bin/trail.js show 127.0.0.1:8769   # 한 사이트의 메모리
node bin/trail.js report                # 세션별 토큰/단계 사용량(효과 측정)
node bin/trail.js forget <호스트>        # 한 사이트의 기억 삭제(스킬 포함)
node bin/trail.js off                   # 자동 학습 일시 정지
node bin/trail.js on                    # 재개
```

Aside 안에서 "지금까지 배운 사이트 보여줘"라고 물어도 된다 — 컨트롤러 스킬이
위 명령을 대신 실행해 준다.

## 무엇을 기억하고, 무엇을 기억하지 않나

기억: 페이지 경로와 이동 순서, 어떤 링크/버튼/입력 칸이 있었는지, 작업 완료를
확인했던 화면, 검증된 바로가기, 경로가 바뀐 이력.

기억하지 않는 것: **입력한 값 자체**(메시지 내용, 수량, 수신자, 가격),
비밀번호·결제 정보, 개인 대화 내용. 입력 칸의 "레이블"만 저장되고 값은 절대
저장되지 않는다. 이메일·전화번호·카드번호 형태는 자동으로 `[redacted]` 처리된다.
모든 데이터는 `~/.trail`, Aside 스킬 폴더, 그리고 Aside 메모리
(`memory/sites/trail-*.md` + MEMORY.md의 표시 구간) 안에만 있고 외부로
나가지 않는다. `trail forget`과 `trail off`는 이 세 곳을 함께 정리한다.

## 지금 버전의 한계 (솔직하게)

- **실제로 끝낸 작업에서만 배운다.** 아직 가보지 않은 사이트 영역은 모른다.
  "이 사이트의 주요 기능을 미리 학습해줘" 같은 사전 학습은 향후 과제다.
- 재사용 채널은 Aside의 `memory/MEMORY.md` 적재에 기댄다 — 실측으로
  CLI 작업(`aside exec`)은 사용자 스킬 카탈로그를 노출하지 않지만
  MEMORY.md는 프롬프트에 들어감을 확인했다(마커 에코 + 단축경로 인용
  실험). 앱 내 대화 세션은 사용자 스킬도 읽으므로 스킬 발행도 병행한다.
  Aside가 메모리 적재 방식을 바꾸면 이 채널이 약해질 수 있다.
- 사이트가 크게 개편되면 첫 작업은 다시 탐색이 필요하다 — 그 작업이
  교정으로 기록된다.
- Aside의 세션 기록 형식(messages.jsonl)에 기대는 비공식 연동이다. Aside
  업데이트로 형식이 바뀌면 수집이 멈출 수 있다 — `trail verify`로 확인 가능.
- 첫 버전은 Aside 전용이다. 저장 형식은 에이전트 비의존적이어서 다른
  에이전트 어댑터를 얹을 수 있게 설계했다.

## 개발

```sh
node --test            # 테스트
node test-site.mjs     # XXPROBE 데모 사이트 (검증 실험용)
node bin/trail.js verify
```

## English

Trail is a local, zero-dependency recorder that watches the Aside browser
agent's session transcripts, distills per-site "how this site is used" memory
(pages, routes, verified shortcuts — never the values you typed), and publishes
it back as auto-loading Aside skills plus a marked index block at the top
of Aside's own memory/MEMORY.md (the channel exec agents actually read).
Install once (`node bin/trail.js init`),
then use Aside as usual. Everything stays on your machine; `trail forget`,
`trail off` give you control. MIT licensed.
