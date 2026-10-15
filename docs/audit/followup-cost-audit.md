# Corrected offline follow-up cost audit

This report supersedes the earlier three-session audit. The old extractor matched dated screenshot paths but ignored bare 16-character IDs in archived JSON `results[].session`. It therefore omitted 117 referenced Aside sessions. The earlier Aside totals and no-repetition finding were incomplete.

## Actual scope and reproduction

The corrected CLI parsed all 40 JSON archives plus the Markdown archive: **41 files, 120 `results[].session` references, 120 unique Aside sessions loaded**. Dated screenshot references normalize to those same sessions rather than adding duplicates. All 120 IDs resolved uniquely; missing logs: **0**; ambiguous directories: **0**.

Resolution lists only immediate dated directories in the supplied Aside root and requires exact `YYYY-MM-DD_<id>` suffix matching. Example: `Aikbo9UhD0ynJTHo` resolved to `2026-10-13_Aikbo9UhD0ynJTHo`. Unrelated session contents, auth, and config were not scanned.

From the repository root, the actual CLI command was:

```sh
P="$HOME/.omo/agent/sessions/--Users-songyeongchan-SongYeongChan-01_Personal-02_Code-04_Service-02_DesktopApp-Trail--/2026-10-09T12-11-59-952Z_01a12093-ce50-70ae-8b69-5ddffadc17ab.jsonl"
C="$HOME/.omo/agent/projects/Trail-a148e886c55a/senpi-task/children"
node bench/audit.mjs --session "$P" --children-root "$C" \
  --benchmark-dir docs/benchmarks --aside-root "$HOME/.aside/u/0/sessions"
```

Exit **0**. Sanitized stdout was installed as `followup-cost-audit.json` using apply_patch: **794,374 bytes**, SHA-256 `1e697363de86fcb11a73fb49cfc7449e34a07c24cb7260fab323809e0fc73ebe`.

## Corrected recorded usage

| Metric | Aside | Senpi parent | Available Senpi children |
|---|---:|---:|---:|
| Counted inputs | 120 | 1 | 3 |
| Assistant messages | 1,638 | 3,487 | 21 |
| Input | 18,636,463 | 21,702,749 | 85,839 |
| Output | 401,133 | 857,302 | 6,225 |
| Cache read | 116,406,231 | 401,849,921 | 1,390,720 |
| Cache write | 0 | 0 | 0 |
| Reasoning, separately reported | 66,837 | 16,446 | 1,389 |
| **Sum totalTokens** | **135,443,827** | **424,409,972** | **1,482,784** |
| **Max totalTokens, one message** | **415,799** | **354,992** | **86,491** |
| Cache share of prompt-side tokens | 86.20% | 94.88% | 94.19% |
| **Recorded cost, USD** | **2.143249039** | **16.2136384** | **2.56036** |

All-unique union: **124 inputs**, **5,146 assistant messages**, **561,336,583 totalTokens**, **20.917247439 recorded USD**. These are not bills. Billing remains unknown; no provider calls were made.

Aside's previous three-session result was 1,368,986 totalTokens and 0.073582342 recorded USD. Neither represented the full referenced-session set. The corrected set also spans five provider/model identities rather than only the Muse identity seen in that subset.

Every counted assistant message reports usage. Reasoning is missing, not zero, on one Aside message and 3,247 parent messages. All 5,146 reported totals equal input + output + cacheRead + cacheWrite; reasoning is not added again. Cache share means cacheRead / (input + cacheRead + cacheWrite).

## Repetition and supported explanations

- Aside: **1,543 calls**, **1,431 distinct name/argument hashes**, **112 repeat excess**, **33 retry-like calls** after an earlier identical call errored. **173 error results**: repl 166, bash 6, read_file 1. The old claim of no Aside repetition is superseded.
- Aside tools include repl 1,204, read_file 260, bash 63, history_search 4, websearch 4, get_time 3, memory_search 2, write_todos 2, webfetch 1. Explicit read targets are hashed: **260 reads, 185 distinct targets**.
- Parent: **3,199 calls**, **1,542 repeat excess**, **183 consecutive identical calls**, **34 retry-like calls**, **21 error results**. Explicit reads: 136 calls, 34 targets.
- These hashes prove identical logged arguments, not unnecessary work or causation. No prompt, answer, argument value, or read target is published.

The confirmed undercount mechanism is the missing structured-ID extraction, reproduced by a failing-before test. The large token sums reflect repeated request contexts: cache reads account for most volume, while Aside's recorded cost components are input 1.525867075, cacheRead 0.529369914, output 0.08801205. The logs do not establish why cache reuse differs or how much repetition was avoidable.

## Snapshot and coverage limits

`pin()` now reads from one descriptor and never beyond its initial stat size, then pins a complete prefix. The parent snapshot is **15,637,740 bytes**, SHA-256 `83ce2396b17f8190d087b63a95bf95f75e7f22600daeaecff23830a827e3b01e`; all inputs remain `final:false`. Later appends do not belong to this snapshot.

Parent linkage remains bounded to five task IDs. Three child logs were available; two contain no assistant messages. **Unavailable:** `st_01a120fd`, `st_01a1388c`. No totals were guessed for them. Native DAG runStats are a separate parent-owned artifact and were not merged. Parent summaries and compactions are not added as usage.

Verification: **12 audit tests pass**, **76 full-suite tests pass**, both exit **0**. New regressions failed before the fix; the snapshot regression observed 491 pinned bytes against an initial 244. Missing and ambiguous lookup cases are tested without reading candidate logs. Existing tests and the unconditional live gate were not edited.
