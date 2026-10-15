import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { main, prepare, verify, ORDERS } from "../bench/prepare.mjs";

const run = promisify(execFile);
const BIN = fileURLToPath(new URL("../bench/prepare.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/run1.messages.jsonl", import.meta.url));
const sha = (s) => createHash("sha256").update(s).digest("hex");

async function fixture(t, training = FIXTURE) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "trail-prepare-test-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await assert.rejects(fs.lstat(root), { code: "ENOENT" });
  });
  const out = path.join(root, "prepared");
  const options = { "training-session": training, model: "fixture/local-model", effort: "high", out };
  return { root, out, options };
}

async function prepared(t) {
  const f = await fixture(t);
  const result = await prepare(f.options);
  const manifest = JSON.parse(await fs.readFile(path.join(f.out, "manifest.json"), "utf8"));
  return { ...f, result, manifest };
}

async function writeManifest(f) {
  await fs.writeFile(path.join(f.out, "manifest.json"), JSON.stringify(f.manifest));
}

test("fixture is distilled once into a frozen treatment and eighteen separate empty/on replicas", async (t) => {
  const f = await prepared(t);
  assert.equal(f.result.status, "PASS");
  assert.equal(f.result.runtimeIsolation, "unverified");
  assert.equal(f.result.liveAllowed, false);
  assert.deepEqual(f.result.cleanup,
    { temporaryHomeRemoved: true, temporaryAccountRemoved: true, cacheCreated: false });
  assert.equal(f.manifest.training.sha256, sha(await fs.readFile(FIXTURE)));
  assert.equal(f.manifest.model, f.options.model);
  assert.equal(f.manifest.effort, "high");
  assert.equal(f.manifest.arms.length, 18);
  assert.equal(new Set(f.manifest.arms.map((a) => a.directory)).size, 18);
  assert.deepEqual(f.manifest.hosts, ["127.0.0.1:8769"]);
  assert.equal(f.manifest.treatmentAllowlist.length, 4);
  const content = await fs.readFile(path.join(f.out,
    "frozen/account/skills/user/trail-127-0-0-1-8769/SKILL.md"), "utf8");
  assert.match(content, /http:\/\/127\.0\.0\.1:8769\/compose/);
  for (const arm of f.manifest.arms) {
    if (arm.condition !== "trail-on") {
      assert.deepEqual(await fs.readdir(path.join(f.out, arm.directory)), []);
      assert.deepEqual(arm.inventory, []);
    } else {
      for (const file of f.manifest.treatmentAllowlist) {
        assert.deepEqual(await fs.readFile(path.join(f.out, arm.directory, file)),
          await fs.readFile(path.join(f.out, "frozen/account", file)));
      }
    }
  }
  await assert.rejects(fs.lstat(path.join(f.out, ".work")), { code: "ENOENT" });
  assert.equal((await verify(f.out)).status, "PASS");
});

test("all six deterministic orders balance positions and ordered carryover pairs", async (t) => {
  const f = await prepared(t);
  assert.deepEqual(f.manifest.schedule, ORDERS);
  assert.equal(new Set(ORDERS.map((order) => order.join(","))).size, 6);
  for (const condition of ORDERS[0]) {
    for (let position = 0; position < 3; position++) {
      assert.equal(ORDERS.filter((order) => order[position] === condition).length, 2);
    }
    for (const other of ORDERS[0].filter((c) => c !== condition)) {
      assert.equal(ORDERS.flatMap((order) => order.slice(0, -1).map((c, i) =>
        c === condition && order[i + 1] === other)).filter(Boolean).length, 2);
    }
  }
  f.manifest.schedule.reverse();
  await writeManifest(f);
  await assert.rejects(verify(f.out), /schedule or baseline/);
});

test("raw prompts, answers, labels, fill values and URL secrets never enter output", async (t) => {
  const f = await fixture(t);
  const source = (await fs.readFile(FIXTURE, "utf8"))
    .replaceAll("FIRST-RUN", "SENTINEL-FILL-PRIVATE")
    .replaceAll("XXPROBE", "SENTINEL-LABEL-PRIVATE")
    .replaceAll("http://127.0.0.1:8769", "http://alice:URL-PRIVATE@127.0.0.1:8769")
    .replaceAll("/services]", "/services?token=QUERY-PRIVATE#FRAGMENT-PRIVATE]")
    .replace("완료했습니다.", "SENTINEL-ANSWER-PRIVATE");
  const training = path.join(f.root, "training.jsonl");
  await fs.writeFile(training, source);
  await prepare({ ...f.options, "training-session": training });
  async function scan(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await scan(file);
      else {
        const bytes = await fs.readFile(file, "utf8");
        assert.doesNotMatch(bytes, /SENTINEL|URL-PRIVATE|QUERY-PRIVATE|FRAGMENT-PRIVATE|alice:/);
      }
    }
  }
  await scan(f.out);
});

for (const mutation of ["modified", "deleted", "extra", "extra-directory"]) {
  test(`verification rejects ${mutation} files rather than trusting arm inventories`, async (t) => {
    const f = await prepared(t);
    const arm = f.manifest.arms.find((a) => a.condition === "trail-on");
    const relative = f.manifest.treatmentAllowlist[0];
    const file = path.join(f.out, arm.directory, relative);
    if (mutation === "modified") {
      await fs.appendFile(file, "\nchanged");
      const data = await fs.readFile(file);
      const entry = arm.inventory.find((e) => e.path === relative);
      entry.sha256 = sha(data);
      entry.bytes = data.length;
      await writeManifest(f);
    } else if (mutation === "deleted") await fs.unlink(file);
    else if (mutation === "extra") await fs.writeFile(path.join(f.out, arm.directory, "unexpected"), "x");
    else await fs.mkdir(path.join(f.out, "unlisted-empty-directory"));
    await assert.rejects(verify(f.out));
  });
}

test("cold/off are independently constrained to empty, even with forged hashes", async (t) => {
  const f = await prepared(t);
  for (const arm of f.manifest.arms.filter((a) => a.condition !== "trail-on")) {
    await fs.writeFile(path.join(f.out, arm.directory, "MEMORY.md"), "remembered");
    arm.inventory = [{ path: "MEMORY.md", type: "file", bytes: 10, sha256: sha("remembered") }];
  }
  await writeManifest(f);
  await assert.rejects(verify(f.out), /schedule or baseline/);
});

test("frozen artifacts are checked and cannot gain unallowlisted treatment files", async (t) => {
  const f = await prepared(t);
  await fs.writeFile(path.join(f.out, "frozen/account/settings.json"), "{}");
  await assert.rejects(verify(f.out), /topology/);
});

test("symlinks and hardlinks are rejected without reading their target", async (t) => {
  const f = await prepared(t);
  const file = path.join(f.out, "frozen/account", f.manifest.treatmentAllowlist[0]);
  const external = path.join(f.root, "external");
  await fs.writeFile(external, "unchanged");
  await fs.unlink(file);
  await fs.symlink(external, file);
  await assert.rejects(verify(f.out), /symlink/);
  await fs.unlink(file);
  await fs.link(external, file);
  await assert.rejects(verify(f.out), /regular files/);
  assert.equal(await fs.readFile(external, "utf8"), "unchanged");
});

test("malformed manifest, traversal and live flags cannot bypass verification", async (t) => {
  const f = await prepared(t);
  const original = structuredClone(f.manifest);
  const mutations = [
    (m) => { m.arms[0].directory = "../../outside"; },
    (m) => { m.treatmentAllowlist.push("../outside"); },
    (m) => { m.hosts = ["../../outside"]; },
    (m) => { m.frozen.directory = "../outside"; },
    (m) => { m.liveAllowed = true; m.runtimeIsolation = "verified"; },
    (m) => { m.training.sha256 = "not-a-hash"; },
    (m) => { delete m.model; },
    (m) => { m.arms.pop(); },
    (m) => { m.unknown = true; },
  ];
  for (const mutate of mutations) {
    f.manifest = structuredClone(original);
    mutate(f.manifest);
    await writeManifest(f);
    await assert.rejects(verify(f.out));
  }
  await fs.writeFile(path.join(f.out, "manifest.json"), "{");
  await assert.rejects(verify(f.out), SyntaxError);
});

test("output reuse, existing empty paths, traversal and symlink parents leave old files intact", async (t) => {
  const f = await prepared(t);
  const original = await fs.readFile(path.join(f.out, "manifest.json"));
  await assert.rejects(prepare(f.options), { code: "EEXIST" });
  assert.deepEqual(await fs.readFile(path.join(f.out, "manifest.json")), original);
  const empty = path.join(f.root, "empty");
  await fs.mkdir(empty);
  await assert.rejects(prepare({ ...f.options, out: empty }), { code: "EEXIST" });
  const linked = path.join(f.root, "linked");
  await fs.symlink(empty, linked);
  await assert.rejects(prepare({ ...f.options, out: linked }), /symlink/);
  await assert.rejects(prepare({ ...f.options, out: `${linked}/new` }), /symlink/);
  await assert.rejects(prepare({ ...f.options, out: `${f.root}/empty/../new` }), /traversal/);
  await assert.rejects(verify(linked), /symlink/);
  assert.deepEqual(await fs.readdir(empty), []);
});

test("invalid or nonreusable training fails cleanly without retaining work roots", async (t) => {
  const f = await fixture(t);
  const training = path.join(f.root, "bad.jsonl");
  for (const source of ["{", '{"role":"assistant","stopReason":"length","content":[{"type":"text","text":"truncated"}]}\n',
    '{"role":"assistant","content":[{"type":"text","text":"no navigation"}]}\n']) {
    await fs.writeFile(training, source);
    await assert.rejects(prepare({ ...f.options, "training-session": training }));
    await assert.rejects(fs.lstat(f.out), { code: "ENOENT" });
  }
  // Reaches distillation, but one page contains no reusable shortcut.
  const messages = [
    { role: "assistant", content: [{ type: "toolCall", name: "repl",
      arguments: { code: "await openTab('http://localhost/'); await snapshot(p);" } }] },
    { role: "toolResult", content: [{ type: "text", text: '- title: "Private" [url=http://localhost/]' }] },
    { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" },
  ];
  await fs.writeFile(training, messages.map((m) => JSON.stringify(m)).join("\n"));
  await assert.rejects(prepare({ ...f.options, "training-session": training }), /owned output removed/);
  await assert.rejects(fs.lstat(f.out), { code: "ENOENT" });
});

test("CLI help, strict arguments and real create/verify keep the user's home unused", async (t) => {
  const f = await fixture(t);
  const home = path.join(f.root, "home");
  const cache = path.join(f.root, "cache");
  await fs.mkdir(home);
  await fs.mkdir(cache);
  await fs.writeFile(path.join(home, "sentinel"), "untouched");
  const env = { ...process.env, HOME: home, TRAIL_HOME: path.join(home, "forbidden"),
    XDG_CACHE_HOME: cache, TMPDIR: f.root };
  assert.match((await run(process.execPath, [BIN, "--help"], { env })).stdout, /liveAllowed: false/);
  const args = ["prepare", "--training-session", FIXTURE, "--model", "fixture/local-model",
    "--effort", "high", "--out", f.out];
  const created = JSON.parse((await run(process.execPath, [BIN, ...args], { env })).stdout);
  assert.equal(created.liveAllowed, false);
  const verified = JSON.parse((await run(process.execPath, [BIN, "verify", f.out], { env })).stdout);
  assert.equal(verified.status, "PASS");
  await fs.writeFile(path.join(f.out, "tamper"), "x");
  await assert.rejects(run(process.execPath, [BIN, "verify", f.out], { env }),
    (e) => e.code === 2 && JSON.parse(e.stderr).liveAllowed === false);
  assert.deepEqual(await fs.readdir(home), ["sentinel"]);
  assert.equal(await fs.readFile(path.join(home, "sentinel"), "utf8"), "untouched");
  assert.deepEqual(await fs.readdir(cache), []);
  for (const argv of [[], ["prepare"], ["verify"], ["--help", "--unsafe"],
    [...args, "--live"], [...args, "--out", "duplicate"], [...args, "--model", "duplicate"]]) {
    await assert.rejects(main(argv));
  }
});
