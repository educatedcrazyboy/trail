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
  assert.equal(
    core.sanitizeUrl("http://x/done?note=secret&ok=1"),
    "http://x/done?note=%24%7Bnote%7D&ok=%24%7Bok%7D"
  );
  assert.equal(core.siteSlug("127.0.0.1:8769"), "127-0-0-1-8769");
});
