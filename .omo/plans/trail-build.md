# Trail build plan (mass-ulw)

## Topology
Run per phase. Phase A `trail-build-a` (build):
- wave1: `core` (src/core.mjs + unit tests + package.json + sanitized fixture)
- wave2 (depend on core): `cli` (src/cli.mjs+bin/trail.js+e2e test), `demo` (test-site.mjs), `skills` (skills/trail/SKILL.md), `docs` (README.md+LICENSE+.gitignore)
- wave3: `verify` (node --test green + CLI smoke + repo audit), depends on all wave2

Category routing: core=unspecified-high (700-line engine, real design surface);
cli=unspecified-high (integration surface, needs live verify vs core API);
demo/skills=quick (spec-precise single files); docs=quick (user-facing README from spec);
verify=quick (runs commands, reports output). Write scopes are disjoint per node.

Phase B (verify live, self-driven — sequential browser experiments):
smoke aside exec → task A → ingest+emit → task B reuse → variant task C → report → cleanup.

## Sequencing reasons
core first: cli verify must exercise real functions; demo/skills/docs are spec-only.
verify last: gate before commits.
Live phase is mine: needs judgment + Aside app interaction + sequential runs.
