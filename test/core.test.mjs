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
  // a settled grown file IS learned (simulates new work appended after install);
  // a file still being written (fresh mtime) waits for the next tick.
  const raw = await fs.readFile(path.join(sessDir, "messages.jsonl"), "utf8");
  const grown = path.join(sessDir, "messages.jsonl");
  await fs.writeFile(grown, raw + raw.split("\n")[1] + "\n");
  const scanned2 = await core.scanSessions(home, acct);
  assert.ok(scanned2.every((r) => !r.fresh), "growing session must settle first");
  const old = new Date(Date.now() - 10 * 60 * 1000);
  await fs.utimes(grown, old, old);
  const scanned3 = await core.scanSessions(home, acct);
  assert.ok(scanned3.some((r) => r.fresh), "settled grown session was not picked up");
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

test("MEMORY index ranks by confidence and caps rows", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await fs.mkdir(path.join(acct, "memory"), { recursive: true });
  await fs.writeFile(path.join(acct, "memory", "MEMORY.md"), "# user notes\n");
  const mkMem = (host, seen, success, extraRoutes = 0) => {
    const routes = [
      { key: "k::h", label: "Task", steps: ["/", "/x", "/goal"], shortcut: "/goal", seen, success, lastSeen: "2026-10-19T00:00:00.000Z" },
    ];
    for (let i = 0; i < extraRoutes; i++) {
      routes.push({ key: `k${i}::h`, label: `Task ${i}`, steps: ["/", `/p${i}`, `/g${i}`], shortcut: `/g${i}`, seen: 1, success: 1, lastSeen: "2026-10-19T00:00:00.000Z" });
    }
    return {
      schema: 1, host, updatedAt: "2026-10-19T00:00:00.000Z", sessions: ["s1"],
      pages: { "/goal": { count: seen, title: "T", heading: "Task", elements: {} } },
      routes, corrections: [], notes: [],
    };
  };
  // thin: seen once; confident: seen often; bulky: many routes (long also-tail)
  await fs.mkdir(path.join(home, "sites", core.siteSlug("thin.test")), { recursive: true });
  await core.saveJson(core.memoryPath(home, "thin.test"), mkMem("thin.test", 1, 1));
  await fs.mkdir(path.join(home, "sites", core.siteSlug("conf.test")), { recursive: true });
  await core.saveJson(core.memoryPath(home, "conf.test"), mkMem("conf.test", 9, 8));
  await fs.mkdir(path.join(home, "sites", core.siteSlug("bulky.test")), { recursive: true });
  await core.saveJson(core.memoryPath(home, "bulky.test"), mkMem("bulky.test", 1, 1, 8));
  const n = await core.syncAsideMemory(home, acct);
  assert.equal(n, 3);
  const md = await fs.readFile(path.join(acct, "memory", "MEMORY.md"), "utf8");
  const rows = md.split("\n").filter((l) => l.startsWith("- ") && l.includes(" → "));
  assert.equal(rows.length, 3);
  // confident site outranks thin single-session sites despite same timestamp
  assert.ok(rows[0].includes("conf.test"), `confident first: ${rows[0]}`);
});

test("ingestFile skips unchanged sessions without re-parsing (stat-first)", async () => {
  const home = await tmp();
  await core.saveConfig(home, { enabled: true, emit: false, accountRoot: path.join(home, "acct") });
  const dir = path.join(home, "sess", "2026-10-19_abc123");
  await fs.mkdir(dir, { recursive: true });
  const f = path.join(dir, "messages.jsonl");
  await fs.copyFile(FIXTURE, f);
  const r1 = await core.ingestFile(home, f);
  assert.equal(r1.fresh, true);
  const st1 = await core.loadJson(path.join(home, "state.json"));
  const r2 = await core.ingestFile(home, f);
  assert.equal(r2.fresh, false);
  assert.deepEqual(r2.results, []);
  const st2 = await core.loadJson(path.join(home, "state.json"));
  assert.equal(st2.sessions[r1.sessionId].ingestedAt, st1.sessions[r1.sessionId].ingestedAt);
});

test("settle:true defers distilling a still-growing session", async () => {
  const home = await tmp();
  await core.saveConfig(home, { enabled: true, emit: false, accountRoot: path.join(home, "acct") });
  const dir = path.join(home, "sess", "2026-10-19_grow01");
  await fs.mkdir(dir, { recursive: true });
  const f = path.join(dir, "messages.jsonl");
  await fs.copyFile(FIXTURE, f);
  await core.ingestFile(home, f, { force: true });
  const mem1 = await core.loadJson(core.memoryPath(home, "127.0.0.1:8769"));
  const seen1 = mem1.routes[0].seen;
  await fs.appendFile(f, await fs.readFile(f, "utf8"));
  const r = await core.ingestFile(home, f, { settle: true });
  assert.equal(r.fresh, false);
  const mem2 = await core.loadJson(core.memoryPath(home, "127.0.0.1:8769"));
  assert.equal(mem2.routes[0].seen, seen1);
});

test("provenance marker is stable across re-emission", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await fs.mkdir(path.join(acct, "memory"), { recursive: true });
  await fs.writeFile(path.join(acct, "memory", "MEMORY.md"), "# notes\n");
  await core.saveConfig(home, { enabled: true, emit: true, accountRoot: acct });
  await core.ingestFile(home, FIXTURE, { force: true });
  const m1 = await core.loadJson(core.memoryPath(home, "127.0.0.1:8769"));
  await core.ingestFile(home, FIXTURE, { force: true });
  const m2 = await core.loadJson(core.memoryPath(home, "127.0.0.1:8769"));
  assert.ok(m1.marker?.startsWith("TRAIL-"));
  assert.equal(m2.marker, m1.marker);
  const skill = await fs.readFile(
    path.join(acct, "skills", "user", `trail-${core.siteSlug("127.0.0.1:8769")}`, "SKILL.md"), "utf8");
  assert.ok(skill.includes(m1.marker));
});

test("scoreReuse detects shortcut-first and hint reuse offline", () => {
  const prior = {
    "h.test": { shortcuts: new Set(["/goal"]), hintSources: new Set(["__next_data__"]) },
  };
  const extracted = {
    sites: {
      "h.test": {
        steps: [
          { kind: "navigate", urlPath: "/goal" },
          { kind: "eval", ok: true, source: "__NEXT_DATA__" },
        ],
      },
      "fresh.test": { steps: [{ kind: "navigate", urlPath: "/" }] },
    },
  };
  assert.deepEqual(core.scoreReuse(prior, extracted), { "h.test": { index: true, hint: true } });
  assert.deepEqual(core.scoreReuse({}, extracted), {});
});

test("ingest records index reuse when a later session opens the shortcut first", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await fs.mkdir(path.join(acct, "memory"), { recursive: true });
  await fs.writeFile(path.join(acct, "memory", "MEMORY.md"), "# notes\n");
  await core.saveConfig(home, { enabled: true, emit: true, accountRoot: acct });
  await core.ingestFile(home, FIXTURE, { force: true }); // teaches /compose
  const dir = path.join(home, "sess", "2026-10-20_reuse01");
  await fs.mkdir(dir, { recursive: true });
  const lines = [
    { role: "user", content: [{ type: "text", text: "open the note page" }], timestamp: 1 },
    { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "repl", arguments: { code: "const p = await openTab('http://127.0.0.1:8769/compose'); console.log(p.url());" } }], usage: { totalTokens: 500 } },
    { role: "toolResult", content: [{ type: "text", text: '- title: "XXPROBE" [url=http://127.0.0.1:8769/compose]' }] },
  ].map((o) => JSON.stringify(o)).join("\n");
  const f = path.join(dir, "messages.jsonl");
  await fs.writeFile(f, lines);
  const r = await core.ingestFile(home, f);
  assert.equal(r.fresh, true);
  assert.deepEqual(r.reuse, { "127.0.0.1:8769": { index: true, hint: false } });
  const rows = await core.report(home);
  const row = rows.find((x) => x.session === "reuse01");
  assert.ok(row.reuse.includes("127.0.0.1:8769:shortcut"), `reuse column: ${row.reuse}`);
});

test("fill through an eN ref keeps the field label, never the value", async () => {
  const x = await core.extractSession(FIXTURE);
  const fill = x.sites["127.0.0.1:8769"].steps.find((s) => s.kind === "fill");
  assert.ok(fill);
  assert.equal(fill.fillField, "쪽지 내용");
});

test("multi-task sites keep every verified shortcut", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await fs.mkdir(path.join(acct, "memory"), { recursive: true });
  await fs.writeFile(path.join(acct, "memory", "MEMORY.md"), "# notes\n");
  await core.saveConfig(home, { enabled: true, emit: true, accountRoot: acct });
  const mem = {
    schema: 1, host: "multi.test", updatedAt: "2026-10-19T00:00:00.000Z", sessions: ["s1", "s2"],
    pages: {
      "/a": { count: 3, title: "T", heading: "Task A", elements: {} },
      "/b": { count: 2, title: "T", heading: "Task B", elements: {} },
    },
    routes: [
      { key: "a::A", label: "Task A", steps: ["/", "/a"], shortcut: "/a", seen: 3, success: 3, lastSeen: "2026-10-19T00:00:00.000Z" },
      { key: "b::B", label: "Task B", steps: ["/", "/b"], shortcut: "/b", seen: 2, success: 2, lastSeen: "2026-10-19T00:00:00.000Z" },
    ],
    corrections: [], notes: [],
  };
  await fs.mkdir(path.join(home, "sites", core.siteSlug("multi.test")), { recursive: true });
  await core.saveJson(core.memoryPath(home, "multi.test"), mem);
  await core.emitSkill(home, acct, "multi.test");
  const skillMd = await fs.readFile(
    path.join(acct, "skills", "user", `trail-${core.siteSlug("multi.test")}`, "SKILL.md"), "utf8");
  assert.ok(skillMd.includes("openTab('http://multi.test/a')"), "STEP 1 opens best shortcut");
  assert.ok(skillMd.includes("open http://multi.test/b"), "second shortcut kept as alternate");
  await core.syncAsideMemory(home, acct);
  const md = await fs.readFile(path.join(acct, "memory", "MEMORY.md"), "utf8");
  const row = md.split("\n").find((l) => l.includes("multi.test"));
  assert.ok(row.includes("/a") && row.includes("/b"), `index row keeps both: ${row}`);
});

test("a corrected shortcut is never suggested again", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await fs.mkdir(path.join(acct, "memory"), { recursive: true });
  await fs.writeFile(path.join(acct, "memory", "MEMORY.md"), "# notes\n");
  await core.saveConfig(home, { enabled: true, emit: true, accountRoot: acct });
  await core.ingestFile(home, FIXTURE, { force: true });
  const raw = await fs.readFile(FIXTURE, "utf8");
  const v2 = raw
    .replaceAll("/compose", "/memo/write")
    .replaceAll("FIRST-RUN", "SECOND-RUN")
    .replaceAll("call_", "cc_");
  const f2 = path.join(home, "run2.messages.jsonl");
  await fs.writeFile(f2, v2);
  await core.ingestFile(home, f2, { force: true });
  const mem = await core.loadJson(core.memoryPath(home, "127.0.0.1:8769"));
  assert.ok((mem.failedShortcuts || []).some((f) => f.shortcut === "/compose"), "negative entry recorded");
  const skillMd = await fs.readFile(
    path.join(acct, "skills", "user", "trail-127-0-0-1-8769", "SKILL.md"), "utf8");
  assert.ok(skillMd.includes("/memo/write"), "new shortcut suggested");
  assert.ok(!skillMd.includes("openTab('http://127.0.0.1:8769/compose')"), "stale shortcut not suggested");
});

test("report golden numbers for the fixture session", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await fs.mkdir(path.join(acct, "memory"), { recursive: true });
  await fs.writeFile(path.join(acct, "memory", "MEMORY.md"), "# notes\n");
  await core.saveConfig(home, { enabled: true, emit: false, accountRoot: acct });
  const dir = path.join(home, "sess", "2026-10-19_golden01");
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(FIXTURE, path.join(dir, "messages.jsonl"));
  await core.ingestFile(home, path.join(dir, "messages.jsonl"));
  const rows = await core.report(home);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].replCalls, 5);
  assert.equal(rows[0].deltaTokens, 5077);
});

test("launchd plist carries daemon flags and a throttle", () => {
  const home = "/tmp/trail-home";
  const withFlags = core.buildLaunchdPlist(home, { interval: 10, accountRoot: "/tmp/acct" });
  assert.ok(withFlags.includes("--interval</string><string>10"), "interval propagated");
  assert.ok(withFlags.includes("--account-root</string><string>/tmp/acct"), "account root propagated");
  assert.ok(withFlags.includes("<key>ThrottleInterval</key>"), "crash loops throttled");
  const plain = core.buildLaunchdPlist(home);
  assert.ok(plain.includes("<key>ThrottleInterval</key>"));
  assert.ok(!plain.includes("--interval"), "no unset flags emitted");
});

test("watch log rotates past 1 MiB", async () => {
  const home = await tmp();
  await fs.writeFile(path.join(home, "watch.log"), "x".repeat(1024 * 1024 + 1));
  await core.rotateWatchLog(home);
  const stat = await fs.stat(path.join(home, "watch.log.1"));
  assert.ok(stat.size > 1024 * 1024);
  await assert.rejects(fs.access(path.join(home, "watch.log")));
  await fs.writeFile(path.join(home, "watch.log"), "small");
  await core.rotateWatchLog(home);
  assert.equal(await fs.readFile(path.join(home, "watch.log"), "utf8"), "small");
});

test("daemonStatus reports a real running flag", async () => {
  const home = await tmp();
  const st = await core.daemonStatus(home);
  assert.equal(typeof st.running, "boolean");
  // the probe is machine-global (launchd label), not home-scoped: on a dev
  // machine with Trail installed this is true, on CI false. Either way the
  // flag comes from launchctl, never from a stale pid file alone.
  assert.ok(!st.running || st.installed);
});

test("ingest survives junk-only sessions with no memory dir yet (no ENOENT)", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct"); // no memory/ dir created on purpose
  await core.saveConfig(home, { enabled: true, emit: true, accountRoot: acct });
  const dir = path.join(home, "sess", "2026-10-21_junk01");
  await fs.mkdir(dir, { recursive: true });
  const lines = [
    { role: "user", content: [{ type: "text", text: "open dead" }], timestamp: 1 },
    { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "repl", arguments: { code: "const p = await openTab('http://nohost.invalid/dead');" } }] },
    { role: "toolResult", content: [{ type: "text", text: "page → nohost.invalid (chrome-error://chromewebdata/)" }] },
  ].map((o) => JSON.stringify(o)).join("\n");
  const f = path.join(dir, "messages.jsonl");
  await fs.writeFile(f, lines);
  const r = await core.ingestFile(home, f); // must not throw ENOENT
  assert.equal(r.fresh, true);
  const md = await fs.readFile(path.join(acct, "memory", "MEMORY.md"), "utf8");
  assert.match(md, /TRAIL-BEGIN/);
});

test("ingest honors an explicit accountRoot override", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await core.saveConfig(home, { enabled: true, emit: true }); // no accountRoot in config
  const r = await core.ingestFile(home, FIXTURE, { force: true, accountRoot: acct });
  assert.equal(r.fresh, true);
  await fs.access(path.join(acct, "skills", "user", "trail-127-0-0-1-8769", "SKILL.md"));
  await fs.access(path.join(acct, "memory", "MEMORY.md"));
});

test("bare chrome-error results teach no route", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await core.saveConfig(home, { enabled: true, emit: false, accountRoot: acct });
  const dir = path.join(home, "sess", "2026-10-21_dead01");
  await fs.mkdir(dir, { recursive: true });
  const lines = [
    { role: "user", content: [{ type: "text", text: "open dead" }], timestamp: 1 },
    { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "repl", arguments: { code: "const p = await openTab('http://nohost.invalid/dead');" } }] },
    { role: "toolResult", content: [{ type: "text", text: "page → nohost.invalid (chrome-error://chromewebdata/)" }] },
  ].map((o) => JSON.stringify(o)).join("\n");
  const f = path.join(dir, "messages.jsonl");
  await fs.writeFile(f, lines);
  await core.ingestFile(home, f);
  const rows = await core.report(home);
  assert.equal(rows[0].sites, "");
});

test("scan defers brand-new files until they settle", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await core.saveConfig(home, { enabled: true, emit: false, accountRoot: acct });
  const sessDir = path.join(acct, "sessions", "2026-10-21_fresh01");
  await fs.mkdir(sessDir, { recursive: true });
  await fs.copyFile(FIXTURE, path.join(sessDir, "messages.jsonl"));
  const scanned = await core.scanSessions(home, acct);
  assert.ok(scanned.every((r) => !r.fresh), "mid-write first sight must wait");
  const old = new Date(Date.now() - 10 * 60 * 1000);
  await fs.utimes(path.join(sessDir, "messages.jsonl"), old, old);
  const scanned2 = await core.scanSessions(home, acct);
  assert.ok(scanned2.some((r) => r.fresh), "settled file picked up");
});

test("list hides sites that taught nothing", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await core.saveConfig(home, { enabled: true, emit: true, accountRoot: acct });
  await fs.mkdir(path.join(home, "sites", core.siteSlug("nohost.invalid")), { recursive: true });
  await core.saveJson(core.memoryPath(home, "nohost.invalid"),
    { schema: 1, host: "nohost.invalid", updatedAt: "2026-10-19T00:00:00.000Z", sessions: ["s1"], pages: {}, routes: [], corrections: [], notes: [] });
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const BIN = path.join(HERE, "..", "bin", "trail.js");
  const r = await run(process.execPath, [BIN, "list", "--home", home]).catch((e) => e);
  assert.ok(!String(r.stdout || "").includes("nohost.invalid"), "dead host not listed");
});

test("same-size rewrite with newer mtime is re-ingested", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await core.saveConfig(home, { enabled: true, emit: false, accountRoot: acct });
  const dir = path.join(home, "sess", "2026-10-21_mtime01");
  await fs.mkdir(dir, { recursive: true });
  const f = path.join(dir, "messages.jsonl");
  await fs.copyFile(FIXTURE, f);
  const old = new Date(Date.now() - 10 * 60 * 1000);
  await fs.utimes(f, old, old);
  const r1 = await core.ingestFile(home, f, { settle: true });
  assert.equal(r1.fresh, true);
  const sameSize = (await fs.readFile(f, "utf8")).replace("쪽지", "abcdef");
  assert.equal(Buffer.byteLength(sameSize), (await fs.stat(f)).size);
  await fs.writeFile(f, sameSize);
  await fs.utimes(f, new Date(Date.now() - 5 * 60 * 1000), new Date(Date.now() - 5 * 60 * 1000));
  const r2 = await core.ingestFile(home, f, { settle: true });
  assert.equal(r2.fresh, true, "mtime-only change must not be silently skipped");
});

test("hostile page titles cannot break skill frontmatter", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await core.saveConfig(home, { enabled: true, emit: true, accountRoot: acct });
  await fs.mkdir(path.join(home, "sites", core.siteSlug("evil.test")), { recursive: true });
  await core.saveJson(core.memoryPath(home, "evil.test"), {
    schema: 1, host: "evil.test", updatedAt: "2026-10-19T00:00:00.000Z", sessions: ["s1"],
    pages: { "/g": { count: 1, title: 'T\n---\nbroken: true', heading: "H", elements: {} } },
    routes: [{ key: "g::H", label: "H", steps: ["/", "/g"], shortcut: "/g", seen: 1, success: 1, lastSeen: "2026-10-19T00:00:00.000Z" }],
    corrections: [], notes: [],
  });
  await core.emitSkill(home, acct, "evil.test");
  const skillMd = await fs.readFile(
    path.join(acct, "skills", "user", `trail-${core.siteSlug("evil.test")}`, "SKILL.md"), "utf8");
  const brokenOut = skillMd.split("\n").some((l) => l.startsWith("broken:"));
  assert.ok(!brokenOut, "frontmatter breakout blocked");
  const desc = skillMd.split("\n").find((l) => l.startsWith("description:"));
  assert.ok(desc && !desc.includes("\n"));
});

test("byte budget holds for CJK-heavy index rows", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await fs.mkdir(path.join(acct, "memory"), { recursive: true });
  await fs.writeFile(path.join(acct, "memory", "MEMORY.md"), "# notes\n");
  const pad = "가".repeat(200);
  for (let i = 0; i < 8; i++) {
    const host = `cjk${i}.test`;
    const routes = [];
    for (let j = 0; j < 5; j++) {
      routes.push({ key: `${j}::${pad}`, label: `${pad} ${j}`, steps: ["/", `/${pad}${j}`, `/goal${j}`], shortcut: `/goal${j}`, seen: 1, success: 1, lastSeen: "2026-10-19T00:00:00.000Z" });
    }
    await fs.mkdir(path.join(home, "sites", core.siteSlug(host)), { recursive: true });
    await core.saveJson(core.memoryPath(home, host),
      { schema: 1, host, updatedAt: "2026-10-19T00:00:00.000Z", sessions: ["s1"], pages: {}, routes, corrections: [], notes: [] });
  }
  await core.syncAsideMemory(home, acct);
  const md = await fs.readFile(path.join(acct, "memory", "MEMORY.md"), "utf8");
  const block = md.slice(md.indexOf("<!-- TRAIL-BEGIN"), md.indexOf("<!-- TRAIL-END") + 20);
  assert.ok(Buffer.byteLength(block, "utf8") <= 6400, `block bytes: ${Buffer.byteLength(block, "utf8")}`);
});

test("unverified routes are never suggested", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await core.saveConfig(home, { enabled: true, emit: true, accountRoot: acct });
  await fs.mkdir(path.join(home, "sites", core.siteSlug("thin.test")), { recursive: true });
  await core.saveJson(core.memoryPath(home, "thin.test"), {
    schema: 1, host: "thin.test", updatedAt: "2026-10-19T00:00:00.000Z", sessions: ["s1"],
    pages: {},
    routes: [
      { key: "a::A", label: "A", steps: ["/", "/a"], shortcut: "/a", seen: 1, success: 0, lastSeen: "2026-10-19T00:00:00.000Z" },
      { key: "b::B", label: "B", steps: ["/", "/b"], shortcut: "/b", seen: 2, success: 2, lastSeen: "2026-10-19T00:00:00.000Z" },
    ],
    corrections: [], notes: [],
  });
  await core.emitSkill(home, acct, "thin.test");
  const skillMd = await fs.readFile(
    path.join(acct, "skills", "user", `trail-${core.siteSlug("thin.test")}`, "SKILL.md"), "utf8");
  assert.ok(skillMd.includes("openTab('http://thin.test/b')"));
  assert.ok(!skillMd.includes("thin.test/a"), "unverified shortcut not suggested");
});

test("skipThin removes unverified-only skills via the shared gate", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await core.saveConfig(home, { enabled: true, emit: true, accountRoot: acct });
  await fs.mkdir(path.join(home, "sites", core.siteSlug("stale.test")), { recursive: true });
  await core.saveJson(core.memoryPath(home, "stale.test"), {
    schema: 1, host: "stale.test", updatedAt: "2026-10-19T00:00:00.000Z", sessions: ["s1"],
    pages: { "/a": { count: 1, elements: {} } },
    routes: [{ key: "a::A", label: "A", steps: ["/", "/a"], shortcut: "/a", seen: 4, success: 0, lastSeen: "2026-10-19T00:00:00.000Z" }],
    failedShortcuts: [{ shortcut: "/a", at: "2026-10-20T00:00:00.000Z", evidence: "session s2" }],
    corrections: [], notes: [],
  });
  const out = await core.emitSkill(home, acct, "stale.test", { skipThin: true });
  assert.equal(out, null);
  await assert.rejects(fs.access(path.join(acct, "skills", "user", `trail-${core.siteSlug("stale.test")}`)));
  // a stale detail file from when the route was verified must go too.
  await fs.mkdir(path.join(acct, "memory", "sites"), { recursive: true });
  await fs.writeFile(path.join(acct, "memory", "sites", `trail-${core.siteSlug("stale.test")}.md`), "# stale\n");
  await core.syncAsideMemory(home, acct);
  await assert.rejects(fs.access(path.join(acct, "memory", "sites", `trail-${core.siteSlug("stale.test")}.md`)));
  assert.equal(core.siteWorthShowing({ routes: [], pages: {}, dataHints: [] }), false);
  assert.equal(core.siteWorthShowing({ routes: [{ shortcut: "/x", seen: 1, success: 1 }], pages: {} }), true);
});

test("watch interval garbage coerces to 30s", () => {
  assert.equal(core.watchIntervalSeconds(undefined), 30);
  assert.equal(core.watchIntervalSeconds("abc"), 30);
  assert.equal(core.watchIntervalSeconds("-5"), 30);
  assert.equal(core.watchIntervalSeconds("0"), 30);
  assert.equal(core.watchIntervalSeconds("10"), 10);
});

test("unverified routes leak nowhere prompt-facing", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await fs.mkdir(path.join(acct, "memory"), { recursive: true });
  await fs.writeFile(path.join(acct, "memory", "MEMORY.md"), "# notes\n");
  await fs.mkdir(path.join(home, "sites", core.siteSlug("mixed.test")), { recursive: true });
  await core.saveJson(core.memoryPath(home, "mixed.test"), {
    schema: 1, host: "mixed.test", updatedAt: "2026-10-19T00:00:00.000Z", sessions: ["s1", "s2"],
    pages: {
      "/ok": { count: 2, title: "T", heading: "Ok", elements: {} },
      "/thin": { count: 1, title: "T", heading: "Thin",
        elements: { textbox: ["Thin field"] },
        dataHints: [{ key: "k", source: "window.__thinSecret", hits: 5, lastSeen: "2026-10-19T00:00:00.000Z" }] },
    },
    // ingest duplicates every eval hint to host level — the host copy must not
    // launder an unverified page's hint into prompt surfaces.
    dataHints: [{ key: "k", source: "window.__thinSecret", hits: 5, lastSeen: "2026-10-19T00:00:00.000Z" }],
    leadsTo: [{ toHost: "other.test", toPath: "/x", fromPage: "/thin", selector: 'link "Go"' }],
    routes: [
      { key: "ok::Ok", label: "Ok", steps: ["/", "/ok"], shortcut: "/ok", seen: 2, success: 2, lastSeen: "2026-10-19T00:00:00.000Z" },
      { key: "thin::Thin", label: "Thin", steps: ["/", "/thin"], shortcut: "/thin", seen: 1, success: 0, lastSeen: "2026-10-19T00:00:00.000Z" },
    ],
    corrections: [], notes: [],
  });
  await core.syncAsideMemory(home, acct);
  const md = await fs.readFile(path.join(acct, "memory", "MEMORY.md"), "utf8");
  const row = md.split("\n").find((l) => l.includes("mixed.test"));
  assert.ok(row.includes("/ok"), "verified shortcut indexed");
  assert.ok(!row.includes("/thin"), `thin path leaks into index row: ${row}`);
  assert.ok(!row.includes("__thinSecret"), `thin hint leaks into index row: ${row}`);
  const detail = await fs.readFile(
    path.join(acct, "memory", "sites", `trail-${core.siteSlug("mixed.test")}.md`), "utf8");
  assert.ok(!detail.includes("open /thin"), "thin route leaks into detail file");
  assert.ok(!detail.includes("__thinSecret"), "thin hint leaks into detail file");
  await core.emitSkill(home, acct, "mixed.test");
  const skillMd = await fs.readFile(
    path.join(acct, "skills", "user", `trail-${core.siteSlug("mixed.test")}`, "SKILL.md"), "utf8");
  assert.ok(!skillMd.includes("__thinSecret"), "thin hint leaks into skill body");
  const refs = await fs.readFile(
    path.join(acct, "skills", "user", `trail-${core.siteSlug("mixed.test")}`, "references", "memory.md"), "utf8");
  assert.ok(!refs.includes("open http://mixed.test/thin"), "thin route leaks into reference guide");
  assert.ok(!refs.includes("/thin"), "thin page leaks into reference guide");
  assert.ok(!refs.includes("other.test"), "unverified edge leaks into reference guide");
  assert.ok(!detail.includes("other.test"), "unverified edge leaks into detail file");
  assert.ok(refs.includes("/ok"), "verified route kept in reference guide");
});

test("legacy junk hosts reach no prompt-facing surface", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await fs.mkdir(path.join(acct, "memory"), { recursive: true });
  await fs.writeFile(path.join(acct, "memory", "MEMORY.md"), "# notes\n");
  for (const host of ["chromewebdata", "unknown"]) {
    await fs.mkdir(path.join(home, "sites", core.siteSlug(host)), { recursive: true });
    await core.saveJson(core.memoryPath(home, host),
      { schema: 1, host, updatedAt: "2026-10-19T00:00:00.000Z", sessions: ["s1"],
        pages: { "/x": { count: 1, elements: {} } },
        routes: [{ key: "x::X", label: "X", steps: ["/x"], shortcut: "/x", seen: 3, success: 3, lastSeen: "2026-10-19T00:00:00.000Z" }],
        corrections: [], notes: [] });
  }
  await core.syncAsideMemory(home, acct);
  const md = await fs.readFile(path.join(acct, "memory", "MEMORY.md"), "utf8");
  assert.ok(!md.includes("chromewebdata") && !md.includes("- unknown"), "junk hosts not indexed");
  assert.equal(core.siteWorthShowing({ host: "chromewebdata", routes: [{ shortcut: "/x", seen: 1, success: 1 }], pages: {} }), false);
});

test("sync sweeps orphan detail files", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await fs.mkdir(path.join(acct, "memory", "sites"), { recursive: true });
  await fs.writeFile(path.join(acct, "memory", "MEMORY.md"), "# notes\n");
  await fs.writeFile(path.join(acct, "memory", "sites", "trail-gone-test.md"), "# orphan\n");
  // leftover empty site dir without memory.json counts as gone too.
  await fs.mkdir(path.join(home, "sites", core.siteSlug("stale.test")), { recursive: true });
  await fs.writeFile(path.join(acct, "memory", "sites", `trail-${core.siteSlug("stale.test")}.md`), "# stale\n");
  await core.syncAsideMemory(home, acct);
  await assert.rejects(fs.access(path.join(acct, "memory", "sites", "trail-gone-test.md")));
  await assert.rejects(fs.access(path.join(acct, "memory", "sites", `trail-${core.siteSlug("stale.test")}.md`)));
});

test("frontmatter title prefers verified pages", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await core.saveConfig(home, { enabled: true, emit: true, accountRoot: acct });
  await fs.mkdir(path.join(home, "sites", core.siteSlug("div.test")), { recursive: true });
  await core.saveJson(core.memoryPath(home, "div.test"), {
    schema: 1, host: "div.test", updatedAt: "2026-10-19T00:00:00.000Z", sessions: ["s1", "s2"],
    pages: {
      "/thin": { count: 1, title: "Thin Title", heading: "T", elements: {} },
      "/ok": { count: 2, title: "Ok Title", heading: "O", elements: {} },
    },
    routes: [
      { key: "ok::O", label: "O", steps: ["/", "/ok"], shortcut: "/ok", seen: 2, success: 2, lastSeen: "2026-10-19T00:00:00.000Z" },
      { key: "thin::T", label: "T", steps: ["/", "/thin"], shortcut: "/thin", seen: 1, success: 0, lastSeen: "2026-10-19T00:00:00.000Z" },
    ],
    corrections: [], notes: [],
  });
  await core.emitSkill(home, acct, "div.test");
  const skillMd = await fs.readFile(
    path.join(acct, "skills", "user", `trail-${core.siteSlug("div.test")}`, "SKILL.md"), "utf8");
  const desc = skillMd.split("\n").find((l) => l.startsWith("description:"));
  assert.ok(desc.includes("Ok Title"), `verified title wins: ${desc}`);
  assert.ok(!desc.includes("Thin Title"), `unverified title loses: ${desc}`);
});

test("hint-only index rows name the host, never a root arrow", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await fs.mkdir(path.join(acct, "memory"), { recursive: true });
  await fs.writeFile(path.join(acct, "memory", "MEMORY.md"), "# notes\n");
  await fs.mkdir(path.join(home, "sites", core.siteSlug("tem.test")), { recursive: true });
  await core.saveJson(core.memoryPath(home, "tem.test"), {
    schema: 1, host: "tem.test", updatedAt: "2026-10-19T00:00:00.000Z", sessions: ["s1", "s2"],
    pages: {
      "/thing/{id}": { count: 2, title: "T", heading: "H", elements: {},
        dataHints: [{ key: "k", source: "__DATA__", hits: 3, lastSeen: "2026-10-19T00:00:00.000Z" }] },
    },
    routes: [
      { key: "t::H", label: "H", steps: ["/", "/thing/{id}"], shortcut: "/thing/{id}", seen: 2, success: 2, lastSeen: "2026-10-19T00:00:00.000Z" },
    ],
    corrections: [], notes: [],
  });
  await core.syncAsideMemory(home, acct);
  const md = await fs.readFile(path.join(acct, "memory", "MEMORY.md"), "utf8");
  const row = md.split("\n").find((l) => l.includes("tem.test"));
  assert.ok(row && !row.includes("→ /"), `no root arrow: ${row}`);
  assert.ok(row.includes("__DATA__"), `hint kept: ${row}`);
});

test("emitted skills carry the short boilerplate", async () => {
  const home = await tmp();
  const acct = path.join(home, "acct");
  await core.saveConfig(home, { enabled: true, emit: true, accountRoot: acct });
  await fs.mkdir(path.join(home, "sites", core.siteSlug("diet.test")), { recursive: true });
  await core.saveJson(core.memoryPath(home, "diet.test"), {
    schema: 1, host: "diet.test", updatedAt: "2026-10-19T00:00:00.000Z", sessions: ["s1", "s2"],
    pages: { "/o": { count: 2, title: "T", heading: "O", elements: {} } },
    routes: [{ key: "o::O", label: "O", steps: ["/", "/o"], shortcut: "/o", seen: 2, success: 2, lastSeen: "2026-10-19T00:00:00.000Z" }],
    corrections: [], notes: [],
  });
  await core.emitSkill(home, acct, "diet.test");
  const skillMd = await fs.readFile(
    path.join(acct, "skills", "user", `trail-${core.siteSlug("diet.test")}`, "SKILL.md"), "utf8");
  assert.ok(!skillMd.includes("console.log(p.url())"), "no redundant url log");
  assert.ok(!skillMd.includes("Applies automatically"), "no tagline");
  assert.ok(skillMd.includes("cite only if used."), "short tail kept");
  assert.ok(!skillMd.includes("actually used this skill"), "long tail gone");
});
