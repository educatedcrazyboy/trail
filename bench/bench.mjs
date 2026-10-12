// Trail benchmark: cold run vs rerun(trail on) vs rerun(trail off).
// Measures per-session totalTokens (from messages.jsonl usage), repl step
// count, and wall-clock time of each `aside exec` run.
// Zero dependencies.
// Usage: node bench/bench.mjs <task.json>   — see bench/tasks/*.json
import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TRAIL = path.join(ROOT, "bin", "trail.js");
const SITE = path.join(ROOT, "test-site.mjs");
const ASIDE = path.join(os.homedir(), ".local", "bin", "aside");
const SESSIONS = path.join(os.homedir(), ".aside", "u", "0", "sessions");

const taskFile = process.argv[2];
const model = process.argv.includes("--model")
  ? process.argv[process.argv.indexOf("--model") + 1]
  : null;
const effort = process.argv.includes("--effort")
  ? process.argv[process.argv.indexOf("--effort") + 1]
  : null;
if (!taskFile) {
  console.error("usage: node bench/bench.mjs bench/tasks/<name>.json");
  process.exit(2);
}
const task = JSON.parse(await fs.readFile(taskFile, "utf8"));
const HOST = task.host;
// all hosts this task can touch — fairness: cold means ZERO memory anywhere
const HOSTS = Array.isArray(task.hosts) && task.hosts.length ? task.hosts : [HOST];

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return r.stdout + (r.stderr || "");
}
const trail = (...a) => sh(process.execPath, [TRAIL, ...a]);

async function listSessionIds() {
  const dirs = await fs.readdir(SESSIONS, { withFileTypes: true });
  return new Set(dirs.filter((d) => d.isDirectory()).map((d) => d.name));
}

async function measureSession(id) {
  const file = path.join(SESSIONS, id, "messages.jsonl");
  const lines = (await fs.readFile(file, "utf8")).trim().split("\n");
  let tokens = 0;
  let replCalls = 0;
  for (const l of lines) {
    const m = JSON.parse(l);
    if (m.usage?.totalTokens) tokens = Math.max(tokens, m.usage.totalTokens);
    for (const c of m.content || []) {
      if (c.type === "toolCall" && c.name === "repl") replCalls++;
    }
  }
  return { session: id.replace(/^\d{4}-\d{2}-\d{2}_/, ""), tokens, replCalls };
}

async function runTask() {
  const before = await listSessionIds();
  const t0 = Date.now();
  const out = await new Promise((resolve, reject) => {
    const args = ["exec"];
    if (model) args.push("-m", model);
    if (effort) args.push("--effort", effort);
    // fairness: every scenario warms the SAME hosts first — open each
    // host root, then close the tabs — so TLS/JS/DNS cache state is equal
    // and no run gets a free warm cache from the previous one.
    args.push(
      `먼저 openTab으로 ${HOSTS.map((h) => `http://${h}`).join(" 과 ")} 를 각각 열어 보고, 그 탭들을 모두 닫아. 그 다음에 이 작업을 해: ` +
        task.task +
        // token-leak guard: an effort-off agent that loses the plot can loop
        // hundreds of read_file/repl calls (observed: 206 calls, 415k tokens).
        // A hard call budget identical across scenarios keeps one runaway
        // run from torching the whole suite budget — fairness is preserved
        // because the same cap binds cold, trail-on, and trail-off alike.
        ` 한계: 도구 호출은 총 40회까지. 40회 안에 답을 못 찾으면 찾은 것까지만 요약하고 멈춰.`
    );
    const p = spawn(ASIDE, args, { encoding: "utf8" });
    let buf = "";
    p.stdout.on("data", (d) => (buf += d));
    p.stderr.on("data", (d) => (buf += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(buf) : reject(new Error(`aside exec exit ${code}\n${buf.slice(-800)}`))
    );
  });
  const wallMs = Date.now() - t0;
  const after = await listSessionIds();
  const fresh = [...after].filter((x) => !before.has(x));
  const m = out.match(/created new session: (\w+)/);
  const id = fresh.find((d) => m && d.endsWith(m[1])) || fresh[fresh.length - 1];
  if (!id) throw new Error("no new session detected");
  // the session dir appears before messages.jsonl is flushed — wait for it
  const file = path.join(SESSIONS, id, "messages.jsonl");
  for (let i = 0; i < 40; i++) {
    try {
      await fs.access(file);
      break;
    } catch {
      await new Promise((s) => setTimeout(s, 250));
    }
  }
  const stats = await measureSession(id);
  const transcript = await fs.readFile(path.join(SESSIONS, id, "messages.jsonl"), "utf8");
  const done = (task.doneCheck || []).every((s) => out.includes(s) || transcript.includes(s));
  return { ...stats, wallMs, done, tail: out.trim().split("\n").slice(-3).join(" ") };
}

// ---------- run ----------

console.log(`bench "${task.name}" on ${HOST}`);
let server = null;
if (task.demoSite) {
  server = spawn(process.execPath, [SITE, `--variant=${task.variant || "v1"}`], { stdio: "ignore" });
  await new Promise((s) => setTimeout(s, 800));
}

// --only=cold|trail-on|trail-off runs just one scenario (for resuming a
// crashed bench); the usual full run keeps the original sequence.
const ONLY = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : null;

const results = [];
// fairness: the launchd watcher must not ingest benchmark sessions mid-run
// (it would resurrect memory between runs). Stop it; restore in finally.
const wasWatching = !!trail("status").match(/watcher:.*running|running.*pid/i);
if (wasWatching) {
  trail("stop");
  console.log("watcher stopped for the bench — restored at the end");
}

async function scenario(name) {
  console.log(`[${name}] run…`);
  const r = await runTask();
  results.push({ scenario: name, ...r });
  console.log(`  -> ${r.tail}`);
}

try {
  if (!ONLY || ONLY === "cold") {
    // A. cold — forget every host this task touches FIRST (forget re-writes
    // the index via unsync->sync), THEN strip the whole index off. Doing
    // it in the old order (off, then forget) re-created the index for the
    // cold run — cold carried ~250 unrelated site lines that trail-off
    // never saw.
    for (const h of HOSTS) trail("forget", h);
    trail("off");
    await scenario("cold");
  }

  if (!ONLY || ONLY === "trail-on") {
    // learn whatever sessions exist since cold, then rerun with memory ON.
    // watch --once runs while cfg.emit=false (trail off state), so it only
    // fills memory.json — 'on' rewrites the index but does NOT re-emit
    // skills. distill closes that gap: SKILL.md + references are
    // auto-injected context trail-on depends on.
    console.log("[ingest] letting Trail learn…");
    trail("watch", "--once");
    trail("on"); // re-emit the index so the run actually sees it
    trail("distill"); // re-emit per-site skills too (auto-injected body)
    await scenario("trail-on");
  }

  if (!ONLY || ONLY === "trail-off") {
    // C. trail off — rerun blind. 'off' strips the index + site files but
    // leaves skills/user/trail-* dirs in place; forget each task host first
    // so trail-off can't ride the skill trail-on just created.
    for (const h of HOSTS) trail("forget", h);
    trail("off");
    await scenario("trail-off");
  }
} finally {
  trail("on");
  if (wasWatching) trail("start");
  server?.kill("SIGTERM");
}

// ---------- report ----------

const fmt = (r) =>
  `${r.scenario.padEnd(10)} ${String(r.replCalls).padStart(4)} steps  ` +
  `${String(r.tokens).padStart(7)} tokens  ${(r.wallMs / 1000).toFixed(0).padStart(5)}s  ` +
  `${r.done ? "done" : "INCOMPLETE"}  ${r.session}`;
console.log("\nscenario      steps   tokens   wall   result   session");
console.log("-".repeat(66));
for (const r of results) console.log(fmt(r));
const a = results[0];
if (a?.tokens) {
  for (const r of results.slice(1)) {
    console.log(
      `${r.scenario} vs cold: ${((r.tokens / a.tokens - 1) * 100).toFixed(0)}% tokens, ` +
        `${((r.wallMs / a.wallMs - 1) * 100).toFixed(0)}% time`
    );
  }
}

const outDir = path.join(ROOT, "docs", "benchmarks");
await fs.mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
await fs.writeFile(
  path.join(outDir, `${task.name}-${stamp}.json`),
  JSON.stringify({ task: task.name, host: HOST, results }, null, 2)
);
console.log(`saved docs/benchmarks/${task.name}-${stamp}.json`);
