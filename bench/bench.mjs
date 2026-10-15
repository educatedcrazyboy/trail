// Live benchmarking is disabled until independently verified isolation exists.
// Existing session measurements are read-only and do not certify fairness.
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { measureSession, checkProvenanceExpectation } from "./measure.mjs";

export const USAGE = "usage: node bench/bench.mjs <task.json> [--only cold|trail-on|trail-off] [--repeat N] [--model <id>|-m <id>]\n" +
  "       node bench/bench.mjs --measure-session <messages.jsonl> --task <task.json> [--account-root <dir>]\n" +
  "         [--expected-model <logged model id>] [--expected-provider <logged provider>]";

export function parseArgs(argv) {
  const options = { repeat: 1, rotate: false };
  const values = new Set(["only", "repeat", "model", "effort", "measure-session", "task", "account-root",
    "expected-model", "expected-provider"]);
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let shortAlias = null;
    if (arg === "-m" || arg.startsWith("-m=")) {
      // -m is a strict alias for --model; it must never be silently ignored.
      shortAlias = "-m";
      arg = arg === "-m" ? "--model" : `--model${arg.slice(2)}`;
    } else if (arg.startsWith("-") && !arg.startsWith("--")) {
      throw new Error(`unsupported option: ${argv[i]}`);
    }
    if (!arg.startsWith("--")) {
      if (options.taskFile) throw new Error("only one positional task file is allowed");
      options.taskFile = arg;
      continue;
    }
    const equal = arg.indexOf("=");
    const key = arg.slice(2, equal < 0 ? undefined : equal);
    if (seen.has(key)) throw new Error(`duplicate --${key}${shortAlias ? ` (${shortAlias} alias)` : ""}`);
    seen.add(key);
    if (key === "rotate" && equal < 0) {
      options.rotate = true;
      continue;
    }
    if (!values.has(key)) throw new Error(`unsupported option: ${arg}`);
    const value = equal < 0 ? argv[++i] : arg.slice(equal + 1);
    const flag = shortAlias ?? `--${key}`;
    const identityKey = ["model", "expected-model", "expected-provider"].includes(key);
    if (!value || value.startsWith("--") || (identityKey && value.startsWith("-"))) {
      throw new Error(`${flag} requires a value`);
    }
    options[key] = value;
  }
  if (options.task && options.taskFile) throw new Error("use --task or a positional task, not both");
  options.taskFile = options.task || options.taskFile;
  if (!options.taskFile) throw new Error(USAGE);
  if (options.only && !["cold", "trail-on", "trail-off"].includes(options.only)) {
    throw new Error("invalid --only: expected cold, trail-on, or trail-off");
  }
  if (!/^[1-9]\d*$/.test(String(options.repeat)) || !Number.isSafeInteger(Number(options.repeat))) {
    throw new Error("--repeat must be a positive safe integer in decimal notation");
  }
  options.repeat = Number(options.repeat);
  if (options["measure-session"] && [...seen].some((key) =>
    !["measure-session", "task", "account-root", "expected-model", "expected-provider"].includes(key))) {
    throw new Error("read-only measurement cannot use live benchmark options");
  }
  return options;
}

export function requireLiveIsolation(options) {
  if (options.rotate) {
    throw new Error("--rotate is unsupported: rotating the current cold/learn/rerun sequence changes learning provenance. " +
      "Implement isolated replicas with identical learning inputs before enabling rotation; no calls were made.");
  }
  // No caller-supplied boolean, environment variable, or file is isolation proof.
  // Do not read config, stop watchers, start demo servers, or spawn any CLI here.
  throw new Error("FAIRNESS-FIRST: live benchmark refused before any CLI spawn or state mutation. " +
    "Browser/account memory isolation is unproven; no trusted isolation verifier exists. " +
    "Implement independently verified browser and account-memory isolation before enabling live runs. " +
    "Use --measure-session <messages.jsonl> --task <task.json> for read-only historical measurement.");
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (!options["measure-session"]) requireLiveIsolation(options);
  const task = JSON.parse(await fs.readFile(options.taskFile, "utf8"));
  const result = await measureSession(options["measure-session"], task, options["account-root"]);
  if (options["expected-model"] || options["expected-provider"]) {
    const expectation = checkProvenanceExpectation(result.provenance, {
      model: options["expected-model"] ?? null,
      provider: options["expected-provider"] ?? null,
    });
    result.provenance.expectation = expectation;
    result.provenance.verified = expectation.satisfied;
    if (!expectation.satisfied) {
      const error = new Error("model provenance expectation failed: " + expectation.problems.join("; "));
      error.result = result;
      throw error;
    }
  }
  return result;
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || "")).href) {
  try {
    console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2));
  } catch (error) {
    if (error.result) console.log(JSON.stringify(error.result, null, 2));
    console.error(error.message);
    process.exitCode = 2;
  }
}
