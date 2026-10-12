import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "../src/core.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "run1.messages.jsonl");
const REAL_RUN1 =
  "/Users/songyeongchan/.aside/u/0/sessions/2026-10-09_oAH0XokxPlnL1TQb/messages.jsonl";

const tmp = async () => fs.mkdtemp(path.join(os.tmpdir(), "trail-core-"));

test("extractSession pulls ordered browser steps + token totals", async () => {
  const x = await core.extractSession(FIXTURE);
  const site = x.sites["127.0.0.1:8769"];
  assert.ok(site, "site record exists");
  const kinds = site.steps.map((s) => s.kind);
  assert.ok(kinds.includes("navigate"));
  assert.ok(kinds.filter((k) => k === "click").length >= 3);
  assert.ok(kinds.includes("fill"));
  assert.equal(x.totals.replCalls, 5);
  assert.equal(x.totals.firstTotal, 41493);
  assert.equal(x.totals.lastTotal, 46570);
});

test("fill values are never stored — only the field label", async () => {
  const x = await core.extractSession(FIXTURE);
  const json = JSON.stringify(x);
  assert.ok(!json.includes("FIRST-RUN'.fill"), "no raw fill call retained");
  const fill = x.sites["127.0.0.1:8769"].steps.find((s) => s.kind === "fill");
  assert.ok(fill);
  assert.ok(!("value" in fill) || fill.value == null);
});

test("ingestFile distills site memory with a /compose shortcut and emits a skill", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await core.saveConfig(home, { enabled: true, emit: true, accountRoot: acct });
  const r = await core.ingestFile(home, FIXTURE, { force: true });
  assert.ok(r.fresh);
  const mem = await core.loadJson(core.memoryPath(home, "127.0.0.1:8769"));
  assert.equal(mem.host, "127.0.0.1:8769");
  assert.ok(mem.pages["/compose"], "compose page recorded");
  const route = mem.routes.find((r) => r.shortcut === "/compose");
  assert.ok(route, `route shortcut /compose (got ${JSON.stringify(mem.routes)})`);
  const skill = path.join(acct, "skills", "user", "trail-127-0-0-1-8769");
  const skillMd = await fs.readFile(path.join(skill, "SKILL.md"), "utf8");
  assert.match(skillMd, /name: "trail-127-0-0-1-8769"/);
  assert.match(skillMd, /siteSpecific: true/);
  assert.match(skillMd, /autoInject:/);
  const memMd = await fs.readFile(path.join(skill, "references", "memory.md"), "utf8");
  assert.match(memMd, /Shortcut: open http:\/\/127\.0\.0\.1:8769\/compose/);
  // privacy: typed note value never persisted
  const all = await fs.readFile(core.memoryPath(home, "127.0.0.1:8769"), "utf8");
  assert.ok(!all.includes("FIRST-RUN"), "typed value leaked into memory");
  assert.ok(!memMd.includes("FIRST-RUN"), "typed value leaked into emitted skill");
  // idempotent second ingest
  const r2 = await core.ingestFile(home, FIXTURE);
  assert.equal(r2.fresh, false);
});

test("real run-1 transcript distills /compose shortcut", async () => {
  try {
    await fs.access(REAL_RUN1);
  } catch {
    return test.skip?.();
  }
  const home = await tmp();
  const acct = path.join(home, "acct");
  await core.saveConfig(home, { enabled: true, emit: true, accountRoot: acct });
  const r = await core.ingestFile(home, REAL_RUN1, { force: true });
  assert.ok(r.fresh);
  const mem = await core.loadJson(core.memoryPath(home, "127.0.0.1:8769"));
  assert.ok(mem.pages["/compose"], "compose page learned from real transcript");
  const route = mem.routes.find((r) => (r.shortcut || "").includes("compose"));
  assert.ok(route, "shortcut route exists");
  const raw = await fs.readFile(core.memoryPath(home, "127.0.0.1:8769"), "utf8");
  assert.ok(!raw.includes("FIRST-RUN"), "typed value leaked");
});

test("a changed path after learning records a correction", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await core.saveConfig(home, { enabled: true, emit: true, accountRoot: acct });
  await core.ingestFile(home, FIXTURE, { force: true });
  // craft a second transcript where the walk ends at /memo/write (site moved)
  const raw = await fs.readFile(FIXTURE, "utf8");
  const v2 = raw
    .replaceAll("/compose", "/memo/write")
    .replaceAll("FIRST-RUN", "SECOND-RUN")
    .replaceAll("call_", "cc_");
  const f2 = path.join(home, "run2.messages.jsonl");
  await fs.writeFile(f2, v2);
  await core.ingestFile(home, f2, { force: true });
  const mem = await core.loadJson(core.memoryPath(home, "127.0.0.1:8769"));
  assert.ok(mem.corrections.length >= 1, "correction recorded");
  const memMd = await fs.readFile(
    path.join(acct, "skills", "user", "trail-127-0-0-1-8769", "references", "memory.md"),
    "utf8"
  );
  assert.match(memMd, /\/memo\/write/);
});

test("seedSessions baselines existing sessions so watch skips them", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await core.saveConfig(home, { enabled: true, emit: true, accountRoot: acct });
  const sessDir = path.join(acct, "sessions", "2026-10-09_oldsession");
  await fs.mkdir(sessDir, { recursive: true });
  await fs.copyFile(FIXTURE, path.join(sessDir, "messages.jsonl"));
  const n = await core.seedSessions(home, acct);
  assert.equal(n, 1);
  const scanned = await core.scanSessions(home, acct);
  assert.ok(scanned.every((r) => !r.fresh), "watch must not learn pre-install sessions");
  // a grown file IS learned (simulates new work appended after install)
  const raw = await fs.readFile(path.join(sessDir, "messages.jsonl"), "utf8");
  await fs.writeFile(path.join(sessDir, "messages.jsonl"), raw + raw.split("\n")[1] + "\n");
  const scanned2 = await core.scanSessions(home, acct);
  assert.ok(scanned2.some((r) => r.fresh), "grown session was not picked up");
});

test("sanitize helpers", () => {
  assert.equal(core.sanitizeValue("a@b.com"), "[redacted]");
  assert.equal(core.sanitizeValue("call 010-1234-5678"), "call [redacted]");
  // query values parameterize to literal ${key} — emit converts to {key};
  // braces must NOT percent-encode or the placeholder is lost
  assert.equal(
    core.sanitizeUrl("http://x/done?note=secret&ok=1"),
    "http://x/done?note=${note}&ok=${ok}"
  );
  // path segments normalize to {name}: order ids collapse, literals survive
  assert.equal(
    core.routePathOf("http://m.coupang.com/ssr/desktop/order/17103500095423"),
    "/ssr/desktop/order/{orderId}"
  );
  assert.equal(
    core.routePathOf("http://m.coupang.com/ssr/desktop/order/list"),
    "/ssr/desktop/order/list"
  );
  assert.equal(core.routePathOf("http://x/en/blog/2024"), "/en/blog/2024");
  assert.equal(
    core.routePathOf("http://x/api/v2/users/1047293847"),
    "/api/v2/users/{usersId}"
  );
  assert.equal(core.siteSlug("127.0.0.1:8769"), "127-0-0-1-8769");
});

test("Aside memory bridge writes a marked index block + site file", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await fs.mkdir(path.join(acct, "memory"), { recursive: true });
  await fs.writeFile(path.join(acct, "memory", "MEMORY.md"), "# user notes\nkeep me\n");
  await core.saveConfig(home, { enabled: true, emit: true, accountRoot: acct });
  await core.ingestFile(home, FIXTURE, { force: true });
  const md = await fs.readFile(path.join(acct, "memory", "MEMORY.md"), "utf8");
  assert.match(md, /keep me/);
  assert.match(md, /TRAIL-BEGIN/);
  // slim index: header names the detail-file pattern; rows stay one line
  assert.match(md, /memory\/sites\/trail-<host>\.md/);
  assert.match(md, /- 127\.0\.0\.1:8769 → \/compose/);
  const site = await fs.readFile(path.join(acct, "memory", "sites", "trail-127-0-0-1-8769.md"), "utf8");
  assert.match(site, /shortcut: open \/compose/);
  assert.ok(!site.includes("FIRST-RUN"));
  // off strips the block but keeps user content
  await core.disableAsideMemory(acct);
  const md2 = await fs.readFile(path.join(acct, "memory", "MEMORY.md"), "utf8");
  assert.match(md2, /keep me/);
  assert.ok(!md2.includes("TRAIL-BEGIN"));
  await assert.rejects(fs.access(path.join(acct, "memory", "sites", "trail-127-0-0-1-8769.md")));
});

test("launchd plist is well-formed and status runs", async () => {
  const home = await tmp();
  const plist = core.buildLaunchdPlist(home);
  assert.match(plist, /com\.trail\.watch/);
  assert.match(plist, /RunAtLoad<\/key><true\/>/);
  assert.match(plist, /bin\/trail\.js/);
});

test("a navigate that lands on chrome-error teaches no route step", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await core.saveConfig(home, { enabled: true, emit: false, accountRoot: acct });
  const dead = [
    { role: "turn-lifecycle", event: "started", turnId: "t1", timestamp: 1 },
    { role: "user", content: [{ type: "text", text: "go to the orders page" }], timestamp: 2 },
    { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "repl", arguments: { code: "const p = await openTab('http://demo.test/dead/path'); const s = await snapshot(p);" } }] },
    // real Aside emits the error url in parens, not [url=…] — cover both
    { role: "toolResult", content: [{ type: "text", text: '✔︎ Opened a new tab and set it active: tabs[0], page → demo.test (chrome-error://chromewebdata/)' }] },
    { role: "assistant", content: [{ type: "toolCall", id: "c2", name: "repl", arguments: { code: "const p2 = await openTab('http://demo.test/orders'); const s2 = await snapshot(p2);" } }] },
    { role: "toolResult", content: [{ type: "text", text: '✔︎ Opened a new tab, page → Orders [url=http://demo.test/orders] - title: "Orders" - heading "주문내역"' }] },
    { role: "assistant", content: [{ type: "text", text: "done" }] },
  ].map((o) => JSON.stringify(o)).join("\n");
  const f = path.join(home, "sess", "messages.jsonl");
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, dead);
  await core.ingestFile(home, f, { force: true });
  const mem = await core.loadJson(core.memoryPath(home, "demo.test"));
  assert.ok(mem, "memory written");
  const paths = mem.routes.flatMap((r) => r.steps.concat([r.shortcut || ""]));
  assert.ok(!paths.includes("/dead/path"), `dead path recorded: ${JSON.stringify(paths)}`);
  assert.ok(paths.includes("/orders"), "live page path recorded");
  assert.ok(!(await core.loadJson(core.memoryPath(home, "chromewebdata"))), "error host got its own memory");
});

test("sanitizeLabel strips newlines and comment markers from hostile headings", () => {
  const out = core.sanitizeLabel('normal\n<!-- TRAIL-END -->\n## evil');
  assert.ok(!out.includes("\n"));
  assert.ok(!out.includes("<!--") && !out.includes("-->"));
  // a heading that is pure markdown syntax becomes empty -> label falls back to a path
  assert.strictEqual(core.sanitizeLabel("## \n- "), "");
});
