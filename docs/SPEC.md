# Trail v0.1 — internal spec (contract for builders)

Trail makes the Aside browsing agent automatically record browsing experience and
reuse it on later tasks. Everything lives on the user's machine. No accounts, no
network calls, zero npm dependencies. Node.js >= 18, ESM (`"type": "module"`).

## Repo layout

```
bin/trail.js            # shebang entry → src/cli.mjs main()
src/cli.mjs             # command dispatch + help
src/core.mjs            # all logic: parse, steps, redact, distill, store, emit, report
skills/trail/SKILL.md   # controller skill installed into Aside
test-site.mjs           # XXPROBE demo site (node http, PORT env, --variant=v2)
test/core.test.mjs      # unit tests (node:test)
test/e2e.test.mjs       # cli e2e against fixture transcript
test/fixtures/run1.messages.jsonl  # sanitized extract of real Aside session
docs/SPEC.md            # this file
README.md  LICENSE(MIT)  package.json  .gitignore
```

## Aside integration surfaces (verified on this machine)

- Session transcripts: `<accountRoot>/sessions/<YYYY-MM-DD>_<id>/messages.jsonl`
  where accountRoot = `~/.aside/u/0` (configurable; `--account-root`).
- Line shape: `{"role":"user|assistant|toolResult|turn-lifecycle","content":[...],"usage":{...},"timestamp":<ms>}`
  - assistant content blocks: `{type:"thinking"}`, `{type:"text"}`, and
    `{type:"toolCall","id","name","arguments":{...}}` — browser actions arrive as
    `name:"repl"` with `arguments.title` and `arguments.code` (Playwright-style JS).
  - toolResult content blocks: `{type:"text","text": "<stdout of the repl>"}` —
    snapshot trees look like:
    `- title: "XXPROBE" [url=http://127.0.0.1:8769/compose]`
    `- heading "쪽지 작성" [level=1]`, `- link "쪽지 데스크" [ref=e1]`,
    `- textbox "쪽지 내용" [ref=e1]`, `- button "테스트 쪽지 저장" [ref=e2]`, `- form:`.
  - `usage` is cumulative per session: `{input,output,cacheRead,cacheWrite,reasoning,totalTokens}`.
- Reuse channels (measured 2026-10-09):
  1. `memory/MEMORY.md` — `aside exec` sessions load it into the prompt
     (proven by a marker-echo experiment and by the agent quoting our index
     verbatim). Trail maintains a marked block `<!-- TRAIL-BEGIN/END -->` at
     the TOP with one line per learned site and the verified shortcut
     INLINE, plus detail files at `memory/sites/trail-<slug>.md`. This is
     the channel that actually drives reuse in exec sessions.
  2. `<accountRoot>/skills/user/<name>/SKILL.md` — auto-discovered by the
     app UI agent (description text drives selection; observed: a user skill
     was read unprompted in an app session) but NOT surfaced to `aside exec`
     sessions (two exec runs showed zero skill reads). Emitted anyway for
     app sessions. `siteSpecific:true` + `autoInject:{url:[...]}` exist in
     builtins — emit them too.
  Skill format contract: frontmatter strings MUST be double-quoted YAML.
  Route labels must describe the TASK (the page heading at the task page,
  not the completion page) or skill descriptions mismatch task wording.

## $TRAIL_HOME layout (default `~/.trail`, env `TRAIL_HOME`, flag `--home`)

```
config.json                  # {"enabled":true,"accountRoot":"...","emit":true}
state.json                   # {"sessions":{<id>:{dir,bytes,lastUsageTotal,sites[],stepCount}}}
sites/<hostSlug>/memory.json # site memory v1 (below)
skills ->                    # emitted directly into <accountRoot>/skills/user/trail-<hostSlug>/
```

## Step extraction (deterministic, no LLM)

Parse each `repl` toolCall's `code` for, in order:
`openTab('URL')` | `goto/navigate` URL | `locator('SEL').click()` |
`locator('SEL').fill('VAL')` | `locator('SEL').press('KEY')` |
`selectOption` | `screenshot` | `snapshot(` — treat `read_file` of a
skills/**/SKILL.md or **/memory.md as `step.kind:"skill-read"` (evidence of reuse).
Pair each toolCall with the NEXT toolResult line to learn the resulting page
(URL, title, h1, link/textbox/button labels). A step:

```json
{"kind":"navigate|click|fill|press|snapshot|screenshot|skill-read",
 "selector":"e1|null","label":"쪽지 데스크|null","urlPath":"/compose|null",
 "pageUrl":"/compose|null","pageTitle":"XXPROBE|null","pageHeading":"쪽지 작성|null",
 "fillField":"쪽지 내용|null"}
```

REDACTION (hard rule): the VALUE inside `fill(...)` is never stored — only
`fillField` (the resolved label/name of the input). URL query values are dropped
(pattern + placeholder `${param}` kept). Emails, card/phone-like digit runs,
and obvious secrets in labels are replaced with `[redacted]`. If a page title or
heading equals a user-typed value, keep the heading (it is page structure) but
never copy fill values into it.

## site memory v1 (`sites/<hostSlug>/memory.json`)

```json
{"schema":1,"host":"127.0.0.1:8769","updatedAt":"...","sessions":["oAH0..."],
 "pages":{"/compose":{"count":3,"title":"XXPROBE","heading":"쪽지 작성",
   "elements":{"link":["..."],"textbox":["쪽지 내용"],"button":["테스트 쪽지 저장"]}}},
 "routes":[{"key":"send-note","label":"쪽지 작성","steps":["/","/services","/desk","/compose"],
   "shortcut":"/compose","seen":2,"success":1,"lastSeen":"..."}],
 "corrections":[{"at":"...","what":"shortcut /compose → /memo/write","evidence":"session <id>"}],
 "notes":[{"at":"...","text":"do not reuse note values"}]}
```

Distill rules: group a session's steps by host; a "route" = maximal sequence of
page visits ending in a task-completing page (URL change or completion heading).
`shortcut` = last stable non-param path before the completion URL. Repeated
identical routes merge (seen++). A later session that reaches the goal via a
different path after a learned shortcut existed records a `corrections[]` entry
and updates `shortcut` — never silently overwrite. `report` computes per-session
`deltaTotalTokens = lastTotal-firstTotal` and `replCalls` count.

## CLI (`node bin/trail.js <cmd>`)

`init [--account-root PATH] [--home PATH]` → mkdir $TRAIL_HOME, write config,
install `skills/trail/` into `<accountRoot>/skills/user/trail/`, print what it did.
`ingest <messages.jsonl>` → parse+extract+merge into site memory (+emit skills).
`watch [--interval N]` → poll sessions dir, ingest changed files; `watch --once`.
`distill` → re-emit all skills from memory. `list` → sites table.
`show <host>` → print memory.json. `report` → per-session tokens/steps table.
`forget <host>` → delete site memory + emitted skill. `on`/`off` → config.enabled.
`verify` → self-check print. Every command exits non-zero on failure.

## Emitted site skill (skills/user/trail-<hostSlug>/)

SKILL.md frontmatter:
```yaml
---
name: "trail-<hostSlug>"
siteSpecific: true
description: "Use saved navigation experience for <labels> tasks on <title/host> at <origin>. Applies automatically when working on this site."
autoInject:
  url: ["<host>"]
---
```
Body (short): "Read references/memory.md before browsing <host>. Prefer the
verified shortcut if it still works; otherwise use normal navigation and verify
each result. Treat every requested value (recipient, note text, quantity, price)
as fresh input from the current request — never reuse remembered values. Verify
completion on the page, not from memory."
references/memory.md: site title, observed URL list, per-route shortcut +
steps, element labels per key page, "What to re-check every time" list, a
`Memory provenance marker: TRAIL-<rand6>` line the skill tells the agent to
mention only if it actually used the memory.

## Controller skill `skills/trail/SKILL.md`

description: "Manage Trail learned site memories: show what Trail learned,
delete site memories, or turn Trail's automatic learning on or off."
Body: run `trail <cmd>` (or `node <repo>/bin/trail.js`) — list/show/forget/on/off;
explain that Trail learns automatically; never paste memory contents containing
credentials; confirm before `forget`.

## Demo site `test-site.mjs` (zero-dep node http server)

Serves the recovered XXPROBE structure on PORT (default 8769), `--variant=v2`
moves compose to `/memo/write` (and /compose returns 404):
`/` title XXPROBE h1 "XXPROBE 실험 도서관" link "이용 서비스"→`/services`
h1 "이용 서비스" link "쪽지 데스크"→`/desk` h1 "쪽지 데스크" link "쪽지 작성"→
`/compose` h1 "쪽지 작성" form textbox "쪽지 내용" + button "테스트 쪽지 저장"
→ GET `/done?note=X` h1 "테스트 쪽지 저장 완료" + paragraph echoing X
(HTML-escaped). v2: same but compose link → `/memo/write`.
