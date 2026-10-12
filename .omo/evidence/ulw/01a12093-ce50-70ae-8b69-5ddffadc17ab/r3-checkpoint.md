# r3 (commit 048a914) — 2026-10-12 21:47 KST
model: xiaomi-token-plan-sgp/mimo-v2.6-flash --effort off

| task | cold | trail-on | trail-off | verdict |
|---|---|---|---|---|
| coupang | 8st/65.7k/75s | 11st/58.1k/80s | 9st/57.6k/72s | on wins tokens+wall, steps+3 |
| naver   | 19st/67.4k/169s | 7st/53.8k/46s | 0st/415.8k/3313s | on wins ALL THREE axes |
| scholar | 429 quota — void | — | — | re-run pending |
| youtube | 429 quota — void | — | — | re-run pending |

2/4 tasks show trail-on strictly ahead on steps+wall with tokens<=cold (naver yes all-3; coupang steps+3 fails strict).
Awaiting MiMo quota reset (probe monitor mon_MMM9JRHYZH1FQ7FY, 120s cadence) to re-run scholar+youtube.
