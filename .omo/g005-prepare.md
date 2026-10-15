# G005: local-only preparation CLI

Date: 2026-10-15. Worktree: `/tmp/trail-controls.dbpf1i/worktree`.

Delivered `bench/prepare.mjs` and `test/prepare.test.mjs`, with no helper.
This report is the third deliverable. No source/core, existing benchmark,
settings, user-memory, or other repository files were edited. No commits,
provider calls, browser calls, or live Aside invocations were made.

## Contract and implementation

Run with Node directly; no installation or dependencies are needed:

```sh
node bench/prepare.mjs --help
node bench/prepare.mjs prepare --training-session test/fixtures/run1.messages.jsonl --model fixture/local-model --effort high --out /tmp/NEW-owned-output
node bench/prepare.mjs verify /tmp/NEW-owned-output
```

The output parent must already exist and be owned by the current user, or be
the OS temporary root. The output itself must not exist, even as an empty
directory. Paths containing traversal, arbitrary symlink components, and
non-directory ancestors are rejected. Only the OS temporary-directory alias
is canonicalized (including macOS `/tmp` -> `/private/tmp`).

The implementation reads the supplied session, strictly parses JSONL, requires
a terminal assistant text response without tools or a failed stop reason, and
checks the input hash again after core extraction. The supplied run1 fixture
has no `stopReason`; absent stop reason plus terminal assistant text is accepted
for this fixture format. This is preparation eligibility, not independent
semantic task-success verification.

It calls existing `extractSession`, `distillFlows`, `emitSkill`, and
`syncAsideMemory` APIs. It does not call `ingestFile`, which would persist
prompt-bearing ingestion state. An explicit config disables automatic emission
while distilling. Both the Trail home and emission account are under the newly
owned output's `.work` directory, never a default account or home.

Before distillation, it keeps only validated hosts and structural navigation
paths, normalizes identifiers, removes query/fragment and credentials, drops
known filled values and suspicious paths, and replaces all titles/headings
with fixed labels. It drops prompts, answers, selectors, page element labels,
session identifiers, arbitrary eval sources, and typed values. It emits actual
core-generated navigation treatment; the fixture produces the `/compose`
shortcut. No raw transcript is copied into the output.

The emitted account is moved to `frozen/account`, inventoried, and hashed
before creating any arm. `.work` is removed. The fixed allowlist for each
validated, noncolliding site slug is:

- `memory/MEMORY.md` (one shared index).
- `memory/sites/trail-<slug>.md`.
- `skills/user/trail-<slug>/SKILL.md`.
- `skills/user/trail-<slug>/references/memory.md`.

Every one of the six permutations has three independent account directories,
for 18 accounts total: 12 empty cold/off accounts and six on accounts copied
from the same frozen files. Every condition occupies every position twice;
every ordered adjacent pair occurs twice in the block.

The manifest records the training byte hash and size, explicit model/effort,
frozen inventory/hash, allowlist, exact schedule, and per-arm directory and
inventory. Verification derives the schedule and empty baselines itself,
recomputes the frozen inventory, constrains its exact topology and skill/site
binding, compares every on account to the actual frozen tree, and rejects
unknown/missing manifest fields and unexpected files or empty directories.
File changes, deletion, extra files, symlinks, hardlinks, path traversal,
modified arm inventories, and live-isolation flags cannot legitimize an arm
that differs from the frozen tree or an empty baseline.

## Actual commands and results

All commands below ran in the stated worktree. The model string is an explicit
local fixture label, not a provider request.

Syntax and real creation command (exit 0):

```sh
node --check bench/prepare.mjs &&
node --check test/prepare.test.mjs &&
mkdir -p /tmp/trail-controls.dbpf1i/g005-command-home /tmp/trail-controls.dbpf1i/g005-command-cache &&
HOME=/tmp/trail-controls.dbpf1i/g005-command-home \
XDG_CACHE_HOME=/tmp/trail-controls.dbpf1i/g005-command-cache \
TRAIL_HOME=/tmp/trail-controls.dbpf1i/g005-command-home/forbidden \
node bench/prepare.mjs prepare \
  --training-session test/fixtures/run1.messages.jsonl \
  --model fixture/local-model --effort high \
  --out /tmp/trail-controls.dbpf1i/g005-prepared
```

Creation returned:

```json
{
  "status": "PASS",
  "mode": "local-preparation",
  "runtimeIsolation": "unverified",
  "liveAllowed": false,
  "frozenSha256": "e27637c2cd4a34555470a01c26600960007ce76f751d769c5e6587653bd9a942",
  "arms": 18,
  "cleanup": {
    "temporaryHomeRemoved": true,
    "temporaryAccountRemoved": true,
    "cacheCreated": false
  }
}
```

The manifest's training evidence was 3600 bytes, SHA-256
`da43df24b8db5035ea9fdba7139161d6dd4870d63fe9aaadae070e8426d31324`.
Its host was `127.0.0.1:8769`, with exactly four allowlisted treatment files.

The requested test command ran **once**, exit 0:

```sh
mkdir /tmp/trail-controls.dbpf1i/g005-test-home /tmp/trail-controls.dbpf1i/g005-test-cache &&
HOME=/tmp/trail-controls.dbpf1i/g005-test-home \
XDG_CACHE_HOME=/tmp/trail-controls.dbpf1i/g005-test-cache \
TRAIL_HOME=/tmp/trail-controls.dbpf1i/g005-test-home/forbidden \
node --test test/prepare.test.mjs
```

Actual summary: 14 tests, 14 passed, 0 failed, 0 cancelled, 0 skipped,
0 todo; duration 808.633625 ms. Coverage includes real fixture distillation,
separate arm accounts, all six balanced orders, secret canaries, tamper and
forged arm inventories, frozen topology, symlinks/hardlinks, malformed manifests,
live flags, output reuse, traversal, failure cleanup, and CLI behavior with
task-owned home/cache roots. Each test root's cleanup hook deletes its own
root and confirms `ENOENT`. There are no sleeps or polling-based assertions.

Actual verification command (exit 0):

```sh
HOME=/tmp/trail-controls.dbpf1i/g005-command-home \
XDG_CACHE_HOME=/tmp/trail-controls.dbpf1i/g005-command-cache \
TRAIL_HOME=/tmp/trail-controls.dbpf1i/g005-command-home/forbidden \
node bench/prepare.mjs verify /tmp/trail-controls.dbpf1i/g005-prepared
```

Result: `PASS`, 18 arms, same frozen SHA-256, `runtimeIsolation: "unverified"`,
`liveAllowed: false`; verification created zero temporary roots and no cache.

Actual tamper check: `apply_patch` added the unlisted file
`/tmp/trail-controls.dbpf1i/g005-prepared/tamper-proof` containing a local
sentinel. Repeating the exact verification command above exited **2**:

```json
{
  "status": "FAIL",
  "error": "unexpected or missing preparation files",
  "runtimeIsolation": "unverified",
  "liveAllowed": false
}
```

`git diff --check` exited 0. Scoped status before adding this report showed
only the two new, untracked implementation/test files. Language-server
diagnostics could not run: `typescript-language-server` is not installed.
No dependency installation was attempted; Node syntax and runtime checks ran.

## Cleanup receipts

Before final cleanup, all four command-owned home/cache directories had empty
inventories. The test's simulated user home also retained only its untouched
sentinel, and its cache stayed empty. Preparation verified `.work` absent;
nonreusable-training failure tests verified the owned failed output absent.
Pre-existing-output tests verified existing content remained unchanged.

Final cleanup used Node `fs.rm(path, {recursive: true})` only for the five
known roots created by this lane, followed by `lstat` confirming `ENOENT`:

| Path under `/tmp/trail-controls.dbpf1i/` | Receipt |
| --- | --- |
| `g005-prepared` (including the tamper sentinel) | removed: true |
| `g005-command-home` | removed: true |
| `g005-command-cache` | removed: true |
| `g005-test-home` | removed: true |
| `g005-test-cache` | removed: true |

The generated demonstration artifact was intentionally cleaned, not left as
a reusable runtime account. The CLI and tests can create a new artifact now.
No shared parent, other lane output, user profile, or main account was removed.

## Limits

- Every success and failure reports `runtimeIsolation: "unverified"` and
  `liveAllowed: false`; there is no bypass. Local preparation PASS is not
  actual Aside isolation. Browser authentication/storage, memory search or
  injection, background writes, watchers, provider settings resolution,
  measured session identity, and live lifecycle remain unverified.
- Hashes are reproducibility evidence, not an adversarial signature. An
  attacker replacing the entire frozen tree and matching manifest is outside
  this trust model. Verification does not reread a private training session or
  prove its semantic provenance from its hash alone.
- Sanitization deliberately loses labels and arbitrary data hints. Reviewed
  synthetic training is the intended input: arbitrary sensitive information
  embedded in otherwise ordinary hostnames or human-readable route names
  cannot be classified universally by this structural filter.
- Core emission includes timestamps and a generated marker, so independent
  preparations need not have equal artifact hashes. All arms within one
  preparation share the one finalized frozen artifact byte-for-byte.
- Verification is a point-in-time local filesystem check, not a runtime
  isolation integration or protection against concurrent hostile mutation.
