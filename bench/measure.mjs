import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

// Retained for future verified-isolation execution; the current CLI never calls it.
export function checkedSpawnSync(command, args, options = {}) {
  const result = spawnSync(command, args, { ...options, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed (${result.error?.code || result.signal || result.status}): ` +
      (result.stderr || result.error?.message || ""));
  }
  return (result.stdout || "") + (result.stderr || "");
}

// A future exec path must identify exactly one NEW session by its reported ID.
// Never select the latest directory or match an arbitrary suffix.
export function attributeSession(output, before, after) {
  const ids = [...output.matchAll(/created new session: ([A-Za-z0-9_-]+)(?=\s|$)/g)].map((m) => m[1]);
  if (ids.length !== 1) throw new Error("missing or ambiguous reported session ID");
  const matches = [...after].filter((id) => !before.has(id) &&
    (id === ids[0] || id.replace(/^\d{4}-\d{2}-\d{2}_/, "") === ids[0]));
  if (matches.length !== 1) throw new Error("reported session ID does not identify exactly one new session");
  return matches[0];
}

export function measureMessages(messages, task) {
  if (!Array.isArray(task.doneCheck) || !task.doneCheck.length ||
    !task.doneCheck.every((s) => typeof s === "string" && s.length > 0)) {
    throw new Error("task.doneCheck must contain nonempty completion strings");
  }
  const usage = { messages: 0, totalTokensSum: 0, totalTokensMax: 0,
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  const toolCounts = Object.create(null);
  const contamination = [];
  let finalAssistant = null;
  for (const [index, message] of messages.entries()) {
    if (message.role !== "assistant") continue;
    finalAssistant = message;
    if (message.usage) {
      usage.messages++;
      for (const key of ["totalTokens", "input", "output", "cacheRead", "cacheWrite", "reasoning"]) {
        const value = message.usage[key];
        if (value == null) continue;
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
          throw new Error(`invalid usage.${key} at message ${index + 1}`);
        }
        if (key === "totalTokens") {
          usage.totalTokensSum += value;
          usage.totalTokensMax = Math.max(usage.totalTokensMax, value);
        } else usage[key] += value;
      }
    }
    for (const call of Array.isArray(message.content) ? message.content : []) {
      if (call.type !== "toolCall") continue;
      const name = call.name || "(unnamed)";
      toolCounts[name] = (toolCounts[name] || 0) + 1;
      const args = JSON.stringify(call.arguments || {});
      if (/memory_search/i.test(name) || /\bmemory_search\s*\(/i.test(args)) {
        contamination.push({ message: index + 1, tool: name, kind: "memory_search" });
      }
      // Explicit reads include read_file/read, shell cat, fs reads inside repl,
      // and reference reads; arguments alone are not evidence of a clean run.
      if (/\b(?:read[_-]?file|read|bash|repl|exec|shell)\b/i.test(name) &&
        /(?:MEMORY\.md|memory\.md|memory\.json|[\\/](?:memory|memories)[\\/]|trail-[^"\\\s/]+|\.trail[\\/])/i.test(args)) {
        contamination.push({ message: index + 1, tool: name, kind: "explicit_memory_read" });
      }
    }
  }
  const content = finalAssistant?.content;
  const finalText = typeof content === "string" ? content :
    (Array.isArray(content) ? content.filter((c) => c.type === "text").map((c) => c.text || "").join("\n") : "");
  const stopReason = finalAssistant?.stopReason ?? null;
  const terminalSuccess = ["stop", "end_turn"].includes(stopReason);
  const finalHasTools = Array.isArray(content) && content.some((c) => c.type === "toolCall");
  const toolCalls = Object.values(toolCounts).reduce((sum, n) => sum + n, 0);
  const reasons = ["browser isolation evidence absent", "account memory isolation evidence absent",
    "automatic context injection not excluded"];
  if (contamination.length) reasons.push("observed memory access");
  return {
    schemaVersion: 2,
    mode: "read-only-measurement",
    usage: { ...usage, semantics: "sum of recorded assistant usage; includes cache reads, not normalized inference cost" },
    toolCalls,
    replCalls: toolCounts.repl || 0,
    toolCounts,
    done: terminalSuccess && !finalHasTools && finalText.length > 0 &&
      task.doneCheck.every((s) => finalText.includes(s)),
    stopReason,
    budget: { kind: "advisory", toolCallLimit: 40, enforced: false, exceeded: toolCalls > 40 },
    contamination: { observed: contamination.length > 0, evidence: contamination, clean: null },
    fairness: { valid: false, reasons },
  };
}

export async function measureSession(file, task, accountRoot) {
  if (!file || path.basename(file) !== "messages.jsonl") {
    throw new Error("an explicit messages.jsonl path is required");
  }
  const sessionFile = await fs.realpath(file);
  const sessionDir = path.dirname(sessionFile);
  let root = null;
  if (accountRoot) {
    root = await fs.realpath(accountRoot);
    if (path.dirname(sessionDir) !== path.join(root, "sessions")) {
      throw new Error("session file does not belong to the specified account root");
    }
  } else if (path.basename(path.dirname(sessionDir)) === "sessions") {
    root = path.dirname(path.dirname(sessionDir));
  }
  const messages = (await fs.readFile(sessionFile, "utf8")).split("\n")
    .filter((line) => line.trim()).map((line) => JSON.parse(line));
  return { ...measureMessages(messages, task), session: path.basename(sessionDir),
    sessionFile, accountRoot: root };
}
