Improve Trail (repo cwd) until its trail-on scenario is outstanding vs cold and trail-off on ALL THREE axes — tokens, wall time, repl steps — proven by bench/bench.mjs under its existing fairness rules (forget-before-off, per-run host warm-up, distill-after-on).

Benchmark suite = 4 tasks in bench/tasks/*.json, run cold → trail-on → trail-off each:
1. coupang-tracking.json (exists — multi-hop delivery lookup)
2. naver-blog-stats.json (exists — no-shortcut entry-cost stress test)
3. NEW simple research task — e.g. a Google Scholar / Google one-page fact lookup
4. NEW platform task — e.g. YouTube public search result extraction (read-only, no login)
Model for EVERY run: xiaomi-token-plan-sgp/mimo-v2.6-flash with thinking effort off — verify once whether aside exec accepts "off"; if rejected, pin the lowest supported effort and record it.

SUCCESS BAR (assumed, user may veto): on at least 3 of the 4 tasks, trail-on strictly beats BOTH cold and trail-off in repl steps AND wall-clock time, and trail-on tokens <= cold tokens on those same tasks; every run done under doneCheck.

LOOP: benchmark suite → identify the dominant deficit (tokens vs steps vs time) → smallest code change in src/ → re-benchmark the whole suite → repeat until the bar holds. node --test must stay 13/13 green. Read-only, non-destructive browsing only; logged-in account use allowed.
