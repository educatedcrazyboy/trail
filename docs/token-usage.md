# Token usage anatomy — where a bench suite burns budget

Measured on 60 bench sessions (2026-10-12, `xiaomi-token-plan-sgp/mimo-v2.6-flash --effort off`).

## Cost model

```
session tokens ≈ 42-45k fixed payload  +  ~1.5-3k per tool call
```

| term | size | source |
|---|---|---|
| fixed payload | ~42-45k | system prompt + tool schemas + MEMORY.md + auto-injected site skills. Smallest observed run (7 calls, 17k chars of code): 45,371 tokens. |
| per call | ~1.5-3k | repl call + result (DOM snapshot ~7.9k on a heavy iframe page like naver stats) |
| screenshots | heavy | 10 image blocks ≈ 2.4MB transcript in one session |

A normal suite run: 4 tasks × 3 scenarios × ~60-80k ≈ **0.9-1.5M tokens per suite pass**.

## The leak that matters: runaway loops

Effort-off models that lose the plot do not stop — they loop.
Observed (naver trail-off, session JzJhk64Sq6YYAH0S): **206 tool calls, 55 min, 1.16MB transcript, 415,799 tokens** — ~8x a normal run, ~9% of the day's entire spend in a single run.

Failure shapes:
- `read_file` re-read loop — same episodic-memory file 31x, `2026-09` 30x, `2026-10` 16x.
- Off-task dumps — 26-37k text blocks echoing unrelated Aside docs / personal notes.
- Screenshot spam — 2.4MB of image blocks.
- Thinking blocks in older medium-effort runs (55-164k); `--effort off` removes them.

## Guard

`bench/bench.mjs` appends a hard budget to every scenario prompt:

```
도구 호출은 총 40회까지. 40회 안에 답을 못 찾으면 찾은 것까지만 요약하고 멈춰.
```

Identical across cold / trail-on / trail-off → fairness preserved, worst case capped at ~60k instead of unbounded.

## Implication for Trail

Runaway probability falls when the agent *knows where the answer is*.
naver trail-on (dataHint `/api/blog/visit/uv`): 7 calls, 46s, 53.8k — no loop.
Every accurate hint Trail ships is both a speed win and a leak shutoff.
