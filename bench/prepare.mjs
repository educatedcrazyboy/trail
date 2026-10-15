#!/usr/bin/env node
// Local files only. A preparation PASS never authorizes an Aside invocation.
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import {
  extractSession, parseReplCode, normalizePathname, siteSlug,
  saveConfig, distillFlows, emitSkill, syncAsideMemory,
} from "../src/core.mjs";

const USAGE = `Local-only benchmark preparation (no provider or browser calls)
node bench/prepare.mjs prepare --training-session <messages.jsonl> --model <provider/model> --effort <value> --out <NEW owned directory>
node bench/prepare.mjs verify <directory>
node bench/prepare.mjs --help
PASS means local preparation only; runtimeIsolation: unverified, liveAllowed: false.
Output parent must exist and be owned by this user (or the OS temporary root).
No reuse, symlink components, path traversal, or live-isolation bypass is accepted.`;
const CONDITIONS = ["cold", "trail-on", "trail-off"];
export const ORDERS = [
  ["cold", "trail-on", "trail-off"],
  ["cold", "trail-off", "trail-on"],
  ["trail-on", "cold", "trail-off"],
  ["trail-on", "trail-off", "cold"],
  ["trail-off", "cold", "trail-on"],
  ["trail-off", "trail-on", "cold"],
];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const check = (condition, message) => { if (!condition) throw new Error(message); };
const receipt = { temporaryHomeRemoved: true, temporaryAccountRemoved: true, cacheCreated: false };

// Resolve only the OS's /tmp alias, not arbitrary caller-selected symlinks.
async function safePath(input) {
  check(typeof input === "string" && input.length > 0 && !input.includes("\0"), "invalid path");
  check(!input.split(/[\\/]/).includes(".."), "path traversal refused");
  let absolute = path.resolve(input);
  const tmp = path.resolve(os.tmpdir());
  const realTmp = await fs.realpath(tmp);
  if (absolute === tmp || absolute.startsWith(tmp + path.sep)) {
    absolute = realTmp + absolute.slice(tmp.length);
  }
  // macOS also exposes /tmp when os.tmpdir() is a per-user /var/folders root.
  if (absolute.startsWith("/tmp/") && await fs.realpath("/tmp") === "/private/tmp") {
    absolute = "/private" + absolute;
  }
  let cursor = path.parse(absolute).root;
  const segments = absolute.slice(cursor.length).split(path.sep).filter(Boolean);
  for (const [i, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    try {
      const stat = await fs.lstat(cursor);
      check(!stat.isSymbolicLink(), "symlink path component refused");
      if (i < segments.length - 1) check(stat.isDirectory(), "non-directory path component");
    } catch (error) {
      if (error.code !== "ENOENT" || i !== segments.length - 1) throw error;
    }
  }
  return absolute;
}

async function inventory(directory) {
  const entries = [];
  async function walk(relative) {
    for (const name of (await fs.readdir(path.join(directory, relative))).sort()) {
      const file = relative ? `${relative}/${name}` : name;
      const stat = await fs.lstat(path.join(directory, file));
      check(!stat.isSymbolicLink(), "symlink in inventory");
      if (stat.isDirectory()) {
        entries.push({ path: file, type: "directory" });
        await walk(file);
      } else {
        check(stat.isFile() && stat.nlink === 1, "only unlinked regular files are allowed");
        const bytes = await fs.readFile(path.join(directory, file));
        entries.push({ path: file, type: "file", bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  }
  await walk("");
  return entries.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

function topology(files) {
  const directories = new Set();
  for (const file of files) {
    let parent = path.posix.dirname(file);
    while (parent !== ".") {
      directories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  return [
    ...[...directories].map((p) => ({ path: p, type: "directory" })),
    ...files.map((p) => ({ path: p, type: "file" })),
  ].sort((a, b) => a.path.localeCompare(b.path, "en"));
}

function allowlist(hosts) {
  return ["memory/MEMORY.md", ...hosts.flatMap((host) => {
    const slug = siteSlug(host);
    return [
      `memory/sites/trail-${slug}.md`,
      `skills/user/trail-${slug}/SKILL.md`,
      `skills/user/trail-${slug}/references/memory.md`,
    ];
  })].sort();
}

function validHost(host) {
  if (typeof host !== "string" || !/^[a-z0-9.-]+(?::[0-9]{1,5})?$/.test(host)) return false;
  try { return new URL(`http://${host}`).host === host && !!siteSlug(host); } catch { return false; }
}

// Deliberately retain only structural navigation. Free-form labels, selectors,
// prompts, answers, eval source, session IDs, typed values, query/fragment and
// URL credentials never reach the distiller. This is not a general PII detector
// for hostnames or human-readable route names; use a reviewed synthetic fixture.
function sanitizedExtraction(extracted, messages) {
  const values = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((c) => c.type === "toolCall" && c.name === "repl")
    .flatMap((c) => {
      let args = c.arguments || c.input || {};
      if (typeof args === "string") args = JSON.parse(args);
      return parseReplCode(args.code).filter((a) => a.kind === "fill" && a.value).map((a) => a.value);
    });
  const secretish = /password|passwd|token|secret|api.?key|credential|@/i;
  const cleanPath = (value) => {
    if (typeof value !== "string") return null;
    const bare = value.split(/[?#]/)[0];
    if (!bare.startsWith("/") || /[\\%\r\n]/.test(bare) || secretish.test(bare) ||
      values.some((v) => bare.includes(v))) return null;
    const normalized = normalizePathname(bare);
    if (!/^\/[a-zA-Z0-9/_.{}-]*$/.test(normalized) ||
      normalized.split("/").some((s) => s === ".." || s === "." || s.length > 32)) return null;
    return normalized;
  };
  const sites = Object.create(null);
  for (const [host, site] of Object.entries(extracted.sites)) {
    if (!validHost(host) || secretish.test(host) || values.some((v) => host.includes(v))) continue;
    const steps = site.steps.flatMap((s) => {
      if (s.failed) return [];
      const p = cleanPath(s.urlPath || s.pageUrl);
      if (!p) return [];
      return [{ kind: "page", pageUrl: p, pageTitle: "Training site", pageHeading: "Observed route" }];
    });
    if (steps.length) sites[host] = { steps };
  }
  return { sessionId: "frozen-training", sites };
}

function expectedManifest(model, effort, training, hosts, frozen) {
  return {
    schemaVersion: 1, mode: "local-preparation", runtimeIsolation: "unverified", liveAllowed: false,
    model, effort, training, sanitization: "navigation-only-v1", hosts,
    treatmentAllowlist: allowlist(hosts),
    frozen: { directory: "frozen/account", sha256: hash(json(frozen)), inventory: frozen },
    schedule: ORDERS.map((order) => [...order]),
    arms: ORDERS.flatMap((order, i) => order.map((condition) => ({
      order: i + 1, condition, directory: `arms/${i + 1}/${condition}/account`,
      inventory: condition === "trail-on" ? frozen : [],
    }))),
    cleanup: receipt,
    limits: "Local files only; Aside browser/account/memory isolation remains unverified. Hashes are reproducibility evidence, not an adversarial signature.",
  };
}

function validateSettings(model, effort) {
  check(typeof model === "string" && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/.test(model) &&
    !model.includes(".."), "explicit provider/model required");
  check(typeof effort === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(effort), "explicit effort required");
}

export async function verify(directory) {
  const out = await safePath(directory);
  const all = await inventory(out);
  check(all.some((e) => e.path === "manifest.json" && e.type === "file"), "manifest missing");
  const manifest = JSON.parse(await fs.readFile(path.join(out, "manifest.json"), "utf8"));
  check(manifest && typeof manifest === "object", "malformed manifest");
  validateSettings(manifest.model, manifest.effort);
  check(manifest.training && /^[a-f0-9]{64}$/.test(manifest.training.sha256) &&
    Number.isSafeInteger(manifest.training.bytes) && manifest.training.bytes > 0, "invalid training evidence");
  const hosts = manifest.hosts;
  check(Array.isArray(hosts) && hosts.length > 0 && hosts.every(validHost) &&
    isDeepStrictEqual(hosts, [...new Set(hosts)].sort()) &&
    new Set(hosts.map(siteSlug)).size === hosts.length, "invalid treatment hosts");
  const frozen = await inventory(path.join(out, "frozen/account"));
  check(isDeepStrictEqual(frozen.map(({ path: p, type }) => ({ path: p, type })),
    topology(allowlist(hosts))), "invalid frozen treatment topology");
  for (const host of hosts) {
    const slug = siteSlug(host);
    const skill = await fs.readFile(path.join(out, `frozen/account/skills/user/trail-${slug}/SKILL.md`), "utf8");
    check(skill.startsWith(`---\nname: "trail-${slug}"\n`) &&
      skill.includes(`url: ["${host}"]`), "invalid treatment skill binding");
  }
  const expected = expectedManifest(manifest.model, manifest.effort, manifest.training, hosts, frozen);
  check(isDeepStrictEqual(manifest, expected), "manifest does not match frozen artifacts, schedule or baseline");
  // Derive expected trees independently: a caller cannot legitimize arm edits
  // by changing that arm's declared inventory or checksum.
  for (const arm of expected.arms) {
    const actual = await inventory(path.join(out, arm.directory));
    check(isDeepStrictEqual(actual, arm.inventory), `arm differs from frozen treatment/baseline: ${arm.directory}`);
  }
  const files = ["manifest.json", ...allowlist(hosts).map((p) => `frozen/account/${p}`),
    ...expected.arms.filter((a) => a.condition === "trail-on")
      .flatMap((a) => allowlist(hosts).map((p) => `${a.directory}/${p}`))];
  const expectedTopology = topology(files);
  // Empty account roots are evidence too; reject added empty directories.
  for (const arm of expected.arms.filter((a) => a.condition !== "trail-on")) {
    expectedTopology.push(...topology([`${arm.directory}/placeholder`])
      .filter((e) => e.type === "directory"));
  }
  const unique = [...new Map(expectedTopology.map((e) => [e.path, e])).values()]
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
  check(isDeepStrictEqual(all.map(({ path: p, type }) => ({ path: p, type })), unique),
    "unexpected or missing preparation files");
  return { status: "PASS", mode: "local-preparation", runtimeIsolation: "unverified",
    liveAllowed: false, frozenSha256: expected.frozen.sha256, arms: expected.arms.length,
    cleanup: { temporaryRootsCreated: 0, cacheCreated: false } };
}

export async function prepare(options) {
  validateSettings(options.model, options.effort);
  const out = await safePath(options.out);
  const parent = path.dirname(out);
  const parentStat = await fs.stat(parent);
  const tmp = await fs.realpath(os.tmpdir());
  check(parentStat.isDirectory() &&
    (parentStat.uid === process.getuid() || parent === tmp ||
      parent === await fs.realpath("/tmp")), "output parent must be owned");
  const input = await safePath(options["training-session"]);
  const inputStat = await fs.lstat(input);
  check(inputStat.isFile() && inputStat.nlink === 1, "training must be a regular, non-hardlinked file");
  const raw = await fs.readFile(input);
  const messages = raw.toString("utf8").split("\n").filter((s) => s.trim()).map((s) => JSON.parse(s));
  const final = messages.at(-1);
  check(final?.role === "assistant" && Array.isArray(final.content) &&
    final.content.some((c) => c.type === "text" && c.text?.trim()) &&
    !final.content.some((c) => c.type === "toolCall" || c.type === "tool_call") &&
    (final.stopReason == null || ["stop", "end_turn"].includes(final.stopReason)),
  "completed training session required");
  const extracted = await extractSession(input);
  check(hash(await fs.readFile(input)) === hash(raw), "training changed during extraction");
  const sanitized = sanitizedExtraction(extracted, messages);
  check(Object.keys(sanitized.sites).length > 0, "no sanitized navigation treatment");
  // Atomic exclusive ownership: failure here never cleans up a pre-existing path.
  await fs.mkdir(out, { mode: 0o700 });
  const work = path.join(out, ".work");
  try {
    const home = path.join(work, "home");
    const account = path.join(work, "account");
    await fs.mkdir(account, { recursive: true, mode: 0o700 });
    await saveConfig(home, { enabled: true, emit: false, accountRoot: account });
    await distillFlows(home, sanitized);
    const hosts = [];
    check(new Set(Object.keys(sanitized.sites).map(siteSlug)).size === Object.keys(sanitized.sites).length,
      "colliding treatment hosts");
    for (const host of Object.keys(sanitized.sites).sort()) {
      if (await emitSkill(home, account, host, { skipThin: true })) hosts.push(host);
    }
    check(hosts.length > 0, "training produced no reusable treatment");
    await syncAsideMemory(home, account);
    const frozenDir = path.join(out, "frozen/account");
    await fs.mkdir(path.dirname(frozenDir), { recursive: true });
    // One immutable-in-use snapshot, finalized before any arm is created.
    await fs.rename(account, frozenDir);
    await fs.rm(work, { recursive: true });
    const frozen = await inventory(frozenDir);
    check(isDeepStrictEqual(frozen.map(({ path: p, type }) => ({ path: p, type })),
      topology(allowlist(hosts))), "unexpected emitted treatment topology");
    const manifest = expectedManifest(options.model, options.effort,
      { sha256: hash(raw), bytes: raw.length }, hosts, frozen);
    for (const arm of manifest.arms) {
      const target = path.join(out, arm.directory);
      await fs.mkdir(target, { recursive: true, mode: 0o700 });
      if (arm.condition === "trail-on") {
        for (const file of manifest.treatmentAllowlist) {
          await fs.mkdir(path.dirname(path.join(target, file)), { recursive: true });
          await fs.copyFile(path.join(frozenDir, file), path.join(target, file), fs.constants.COPYFILE_EXCL);
        }
      }
    }
    await fs.writeFile(path.join(out, "manifest.json"), json(manifest), { flag: "wx", mode: 0o600 });
    return { ...await verify(out), cleanup: receipt };
  } catch (error) {
    // Only this invocation's exclusively-created output is removed.
    await fs.rm(out, { recursive: true, force: true });
    throw new Error(`${error.message}; cleanup: owned output removed, no cache created`);
  }
}

export async function main(argv) {
  if (argv.length === 1 && argv[0] === "--help") return { help: USAGE,
    runtimeIsolation: "unverified", liveAllowed: false };
  if (argv[0] === "verify") {
    check(argv.length === 2 && !argv[1].startsWith("--"), "verify requires one directory");
    return verify(argv[1]);
  }
  check(argv[0] === "prepare", USAGE);
  const options = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i].slice(2);
    check(argv[i].startsWith("--") && ["training-session", "model", "effort", "out"].includes(key) &&
      !Object.hasOwn(options, key), "unknown or duplicate option");
    check(argv[i + 1] && !argv[i + 1].startsWith("--"), `missing --${key} value`);
    options[key] = argv[i + 1];
  }
  check(Object.keys(options).length === 4, "training-session, model, effort and out are required");
  return prepare(options);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || "")).href) {
  try {
    const result = await main(process.argv.slice(2));
    console.log(result.help || json(result).trimEnd());
  } catch (error) {
    console.error(json({ status: "FAIL", error: error.message,
      runtimeIsolation: "unverified", liveAllowed: false }).trimEnd());
    process.exitCode = 2;
  }
}
