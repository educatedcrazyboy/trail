# Aside isolation discovery: lead observations

Status: incomplete. No live comparison is authorized by these observations.
The discovery child failed with provider transport errors and left no report.
Lead continued directly without rerunning that child.

## Verified interfaces

- `aside guide` describes `--profile` as a browser-profile selector and
  `--account` as a local account selector. Existing sessions retain their
  original profile. Profile selection is not evidence of memory isolation.
- `aside settings --help` exposes save-sessions and set-default-profile;
  no memory-disable control was listed in that command's help.
- Installed scripting dictionary
  `/Applications/Aside.app/Contents/Resources/scripting.sdef` defines window
  mode as normal/incognito at creation. It does not establish agent-memory
  isolation.
- Actual UI, browser v1.0.928.1, background service v1.26.1012.1759:
  Memory > Configure shows "Enable memories" with description
  "Generate new memories from chats". It was enabled when observed.
  This establishes a generation setting, not disabled retrieval or injection.
  Observed via native AX references e795-e799.
- Memory > Context Awareness shows "Enable Context Awareness", described as
  "Capture your activity on this device." It was disabled/off when observed
  (e951-e957). It is a separate capture channel, not proof that search is off.

## Actions and boundaries

User opened Settings on request. Lead navigated General -> Memory ->
Configure -> Context Awareness using native AX presses. No configuration
toggle, memory file edit, rebuild, deletion, or provider request was made.
Agents navigation was attempted, but Settings then disappeared; fresh
window enumeration showed a different user's page. No further interaction
with that page was attempted.

## Remaining proof

Need to establish separately: task-owned browser profile lifecycle; agent
memory retrieval/injection isolation; per-run memory writes and skill
inventories; frozen training provenance. A UI toggle whose description only
mentions memory generation cannot satisfy these requirements.
