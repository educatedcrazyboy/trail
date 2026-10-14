# Fairness-first benchmark policy

## Priority and scope

Environment equivalence is a prerequisite to running a comparison, not a
property inferred from its results. Unknown isolation must prevent provider
requests. Blocking unsafe execution is necessary but does not complete the
requested fair benchmark environment.

The previous benchmark results remain historical observations, not causal
estimates of Trail's effect. Correcting their accounting does not retroactively
isolate their browser state or remove remembered answers.

## Required evidence before reopening live comparisons

| Channel | Required control and evidence |
| --- | --- |
| Browser | Task-owned contexts with equivalent initial authentication and storage; no shared task-history state. Do not clear or clone the user's main profile. |
| Agent memory | Explicitly isolated account/workspace with non-Trail search, episodic memory and automatic memory writes disabled or confined; capture effective configuration. |
| Trail treatment | One frozen training artifact prepared outside timed trials; only the intended treatment differs. No global ingestion between measured arms. |
| Other skills | Same inventory and content hashes for all arms except the intended Trail artifact. |
| Provider | Explicit model and effort, recorded request settings and cache accounting; no reliance on silent defaults. |
| Execution | Exact session identity, checked subprocess exits, verified watcher state and cleanup receipts. |
| Design | Repeated, counterbalanced trials with the same frozen training artifact; report per-trial observations, failures and spread. |
| Outcome | Check the final answer against task-specific truth; text keywords alone are not semantic success verification. |

A shared-profile root-page warm-up does not establish browser equivalence.
Rotating order does not remove shared memory. A caller-supplied JSON declaration
of isolation is not evidence that the isolation exists.

## Accounting rules

Count all tool calls and retain a separate REPL count. Report summed provider
usage records separately from the largest request's context size. Cache reads
are tokens processed, not equivalent to uncached-token cost; neither measure
alone is a billed-dollar total.

Reject a truncated or failed final assistant turn even if intermediate messages
or the task prompt contain the requested keywords. Historical measurements may
be recomputed read-only without invoking a model.

## Delivery boundary

A fail-closed gate plus honest measurement is an initial safety milestone.
Live fair comparisons remain unavailable until an executable isolation
integration demonstrates the controls above. Do not describe this milestone
as a completed fair environment or resume the paid benchmark suite on that basis.
