---
name: "trail"
description: "Manage Trail learned site memories: show what Trail learned about a website, delete a site's memory, or turn Trail's automatic learning on or off."
---

Trail learns automatically from completed Aside browsing work — the user never needs to invoke it and no manual recording step exists. Use this skill only when the user asks about Trail itself or wants to inspect, delete, or pause what it learned.

## Commands

Run the user's installed Trail CLI (try `trail` first; fall back to `node <path-to-repo>/bin/trail.js`):

- `trail list` — sites with learned memory
- `trail show <host>` — full memory JSON for one site
- `trail report` — per-session token/step usage showing the reuse effect
- `trail forget <host>` — delete one site's memory and its generated skill (confirm with the user first)
- `trail off` — pause learning (data is kept, nothing new is distilled or emitted)
- `trail on` — resume learning
- `trail start` / `trail stop` / `trail status` — manage the always-on background watcher

## Rules

- Explain results in plain terms: which sites Trail knows, which routes it learned, when it last updated.
- Always confirm before `forget` — deletion is permanent.
- Never paste memory contents that might contain sensitive values to other tools or remote services; memory is local-only by design.
- If `trail` is not found, tell the user to run `node bin/trail.js init` from the Trail repo and report what it prints.
