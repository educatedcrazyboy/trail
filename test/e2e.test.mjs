import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "trail.js");
const FIXTURE = path.join(HERE, "fixtures", "run1.messages.jsonl");

const cli = async (argv, opts = {}) =>
  run(process.execPath, [BIN, ...argv], { ...opts }).then(
    (r) => ({ code: 0, ...r }),
    (e) => ({ code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" })
  );

test("trail --help lists every command", async () => {
  const r = await cli(["--help"]);
  assert.equal(r.code, 0);
  for (const c of ["init", "ingest", "watch", "distill", "list", "show", "report", "forget", "on", "off", "verify"])
    assert.match(r.stdout, new RegExp(`\\b${c}\\b`), `missing ${c}`);
});

test("init → ingest → list → show → report → forget lifecycle", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "trail-e2e-"));
  const acct = path.join(home, "acct");

  let r = await cli(["init", "--home", home, "--account-root", acct]);
  assert.equal(r.code, 0, r.stderr);
  await fs.access(path.join(home, "config.json"));
  await fs.access(path.join(acct, "skills", "user", "trail", "SKILL.md"));

  r = await cli(["ingest", "--home", home, FIXTURE]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /127\.0\.0\.1:8769/);
  await fs.access(path.join(acct, "skills", "user", "trail-127-0-0-1-8769", "SKILL.md"));

  r = await cli(["list", "--home", home]);
  assert.match(r.stdout, /127\.0\.0\.1:8769/);

  r = await cli(["show", "--home", home, "127.0.0.1:8769"]);
  const mem = JSON.parse(r.stdout);
  assert.equal(mem.host, "127.0.0.1:8769");

  r = await cli(["report", "--home", home]);
  assert.match(r.stdout, /deltaTokens/);
  assert.match(r.stdout, /run1|messages/);

  r = await cli(["forget", "--home", home, "--account-root", acct, "127.0.0.1:8769"]);
  assert.equal(r.code, 0);
  await assert.rejects(fs.access(path.join(acct, "skills", "user", "trail-127-0-0-1-8769")));
  await assert.rejects(fs.access(path.join(home, "sites", "127-0-0-1-8769")));

  r = await cli(["off", "--home", home]);
  assert.equal(r.code, 0);
  const cfg = JSON.parse(await fs.readFile(path.join(home, "config.json"), "utf8"));
  assert.equal(cfg.enabled, false);

  await fs.rm(home, { recursive: true, force: true });
});
