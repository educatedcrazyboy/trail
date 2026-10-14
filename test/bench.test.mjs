import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess, { execFile } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { main, parseArgs } from "../bench/bench.mjs";
import { attributeSession, checkedSpawnSync, measureMessages, measureSession } from "../bench/measure.mjs";

const run = promisify(execFile);
const BIN = fileURLToPath(new URL("../bench/bench.mjs", import.meta.url));
const task = { name: "fixture", doneCheck: ["shipment"] };
const text = (role, value, stopReason) => ({
  role, content: [{ type: "text", text: value }], ...(stopReason ? { stopReason } : {}),
});
const call = (name, args = {}) => ({ type: "toolCall", name, arguments: args });

async function fixture(t, messages) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "trail-bench-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const account = path.join(root, "account");
  const file = path.join(account, "sessions", "2026-10-13_fixtureID", "messages.jsonl");
  const taskFile = path.join(root, "task.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
  await fs.writeFile(taskFile, JSON.stringify(task));
  return { root, account, file, taskFile };
}

test("historical semantics count every tool and sum usage without claiming fairness", async (t) => {
  const messages = [
    text("user", "shipment"),
    { role: "assistant", content: [
      ...Array.from({ length: 84 }, () => call("repl")),
      ...Array.from({ length: 42 }, () => call("bash")),
    ], usage: { totalTokens: 100, input: 10, output: 5, cacheRead: 85 }, stopReason: "toolUse" },
    text("toolResult", "shipment"),
    { ...text("assistant", "shipment", "length"),
      usage: { totalTokens: 200, input: 15, output: 10, cacheRead: 175 } },
  ];
  const f = await fixture(t, messages);
  const result = await measureSession(f.file, task, f.account);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.toolCalls, 126);
  assert.equal(result.replCalls, 84);
  assert.equal(result.toolCounts.bash, 42);
  assert.equal(result.usage.totalTokensSum, 300);
  assert.equal(result.usage.totalTokensMax, 200);
  assert.equal(result.usage.cacheRead, 260);
  assert.equal(result.done, false);
  assert.deepEqual(result.budget, { kind: "advisory", toolCallLimit: 40, enforced: false, exceeded: true });
  assert.equal(result.fairness.valid, false);
  assert.ok(result.fairness.reasons.length > 0);
  assert.equal(result.contamination.clean, null);
  assert.equal(result.accountRoot, await fs.realpath(f.account));
  assert.equal(result.session, "2026-10-13_fixtureID");
});

test("completion uses only terminal assistant text, never prompts, tools, or earlier answers", () => {
  const prefix = [
    text("user", "shipment"),
    { role: "assistant", content: [call("repl")], stopReason: "toolUse" },
    text("toolResult", "shipment"),
  ];
  assert.equal(measureMessages([...prefix, text("assistant", "not found", "stop")], task).done, false);
  assert.equal(measureMessages([...prefix, text("assistant", "shipment", "stop")], task).done, true);
  assert.equal(measureMessages([text("assistant", "shipment", "stop"), ...prefix], task).done, false);
  assert.equal(measureMessages([...prefix, text("assistant", "shipment")], task).done, false);
  for (const stopReason of ["length", "error", "aborted", "toolUse", "content_filter"]) {
    assert.equal(measureMessages([...prefix, text("assistant", "shipment", stopReason)], task).done, false);
  }
  assert.equal(measureMessages([...prefix, {
    role: "assistant", stopReason: "stop", content: [call("repl"), { type: "text", text: "shipment" }],
  }], task).done, false);
  assert.throws(() => measureMessages([], { doneCheck: [] }));
});

test("observed memory searches and explicit reads are contamination, absence is unknown", () => {
  for (const toolCall of [
    call("memory_search", { query: "orders" }),
    call("repl", { code: "await memory_search('orders')" }),
    call("read_file", { path: "/account/memory/MEMORY.md" }),
    call("read", { path: "/account/skills/user/trail-host/references/memory.md" }),
    call("bash", { command: "cat /trail/sites/host/memory.json" }),
  ]) {
    const result = measureMessages([{ role: "assistant", content: [toolCall] }], task);
    assert.equal(result.contamination.observed, true);
    assert.equal(result.contamination.clean, null);
    assert.equal(result.fairness.valid, false);
  }
  const unobserved = measureMessages([text("assistant", "shipment", "stop")], task);
  assert.equal(unobserved.contamination.observed, false);
  assert.equal(unobserved.contamination.clean, null);
  assert.equal(unobserved.budget.exceeded, false);
});

test("session attribution rejects missing IDs, ambiguous matches, old sessions, and suffix guesses", () => {
  const before = new Set(["2026-10-12_old"]);
  const after = new Set([...before, "2026-10-13_exact", "2026-10-13_other"]);
  assert.equal(attributeSession("created new session: exact\n", before, after), "2026-10-13_exact");
  for (const output of ["", "created new session: act\n", "created new session: old\n",
    "created new session: exact\ncreated new session: other\n"]) {
    assert.throws(() => attributeSession(output, before, after));
  }
  assert.throws(() => attributeSession("created new session: exact", before,
    new Set(["2026-10-12_exact", "2026-10-13_exact"])));
});

test("checked spawning rejects nonzero exit, signals, and spawn errors", async (t) => {
  const f = await fixture(t, []);
  assert.equal(checkedSpawnSync(process.execPath, ["-e", "process.stdout.write('ok')"]), "ok");
  assert.throws(() => checkedSpawnSync(process.execPath, ["-e", "process.exit(7)"]), /7/);
  assert.throws(() => checkedSpawnSync(process.execPath,
    ["-e", "process.kill(process.pid, 'SIGTERM')"]), /SIGTERM/);
  assert.throws(() => checkedSpawnSync(path.join(f.root, "nonexistent-executable"), []), /ENOENT/);
});

test("arguments accept both only forms and strictly validate repeat and read-only combinations", () => {
  for (const only of ["cold", "trail-on", "trail-off"]) {
    assert.equal(parseArgs(["task.json", `--only=${only}`]).only, only);
    assert.equal(parseArgs(["task.json", "--only", only]).only, only);
  }
  assert.equal(parseArgs(["task.json", "--repeat", "3"]).repeat, 3);
  assert.equal(parseArgs(["task.json", "--repeat=2"]).repeat, 2);
  assert.equal(parseArgs(["task.json", "--rotate"]).rotate, true);
  for (const value of ["0", "-1", "1.5", "2x", "1e2", "01", "+1", " ", "9007199254740992"]) {
    assert.throws(() => parseArgs(["task.json", "--repeat", value]));
  }
  for (const argv of [[], ["task.json", "--only"], ["task.json", "--only=invalid"],
    ["task.json", "--repeat"], ["task.json", "--rotate=yes"], ["task.json", "--unsafe"],
    ["task.json", "--only=cold", "--only=trail-off"],
    ["--measure-session", "messages.jsonl", "--task", "task.json", "--repeat=2"]]) {
    assert.throws(() => parseArgs(argv));
  }
});

test("missing isolation refuses before any filesystem access, CLI spawn, or mutation", async (t) => {
  const effects = [];
  for (const method of ["readFile", "realpath", "writeFile", "mkdir", "rm"]) {
    t.mock.method(fs, method, () => { effects.push(method); throw new Error(`unexpected ${method}`); });
  }
  for (const method of ["spawn", "spawnSync", "execFile"]) {
    t.mock.method(childProcess, method, () => { effects.push(method); throw new Error(`unexpected ${method}`); });
  }
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  for (const args of [["missing.json"], ["missing.json", "--only=cold"],
    ["missing.json", "--only", "trail-off", "--repeat", "2"]]) {
    await assert.rejects(main(args), /FAIRNESS-FIRST/);
  }
  await assert.rejects(main(["missing.json", "--rotate"]), /learning provenance/);
  await assert.rejects(main(["missing.json", "--isolation-proof=clean"]), /unsupported option/);
  assert.deepEqual(effects, []);
});

test("read-only CLI uses the explicit session and validates account root without writes", async (t) => {
  const f = await fixture(t, [text("assistant", "shipment", "stop")]);
  const before = await fs.readFile(f.file, "utf8");
  const result = await run(process.execPath, [BIN, "--measure-session", f.file,
    "--task", f.taskFile, "--account-root", f.account], { cwd: f.root });
  const measured = JSON.parse(result.stdout);
  assert.equal(measured.done, true);
  assert.equal(measured.fairness.valid, false);
  assert.equal(measured.sessionFile, await fs.realpath(f.file));
  assert.equal(await fs.readFile(f.file, "utf8"), before);
  await assert.rejects(measureSession(f.file, task, f.root), /account root/);
  await assert.rejects(run(process.execPath, [BIN], { cwd: f.root }), (e) => e.code === 2);
  await assert.rejects(run(process.execPath, [BIN, f.taskFile, "--only=trail-off"], { cwd: f.root }),
    (e) => e.code === 2 && e.stderr.includes("FAIRNESS-FIRST"));
  assert.deepEqual((await fs.readdir(f.root)).sort(), ["account", "task.json"]);
});
