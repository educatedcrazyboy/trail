// Trail core: parse Aside session transcripts, extract browser steps,
// distill them into per-site memory, and emit Aside user skills.
// Node >= 18, ESM, zero dependencies.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_ACCOUNT_ROOT = path.join(os.homedir(), ".aside", "u", "0");

export function defaultHome() {
  return process.env.TRAIL_HOME || path.join(os.homedir(), ".trail");
}

// ---------- transcript parsing ----------

export async function parseMessagesJsonl(file) {
  const raw = await fs.readFile(file, "utf8");
  const messages = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      messages.push(JSON.parse(t));
    } catch {
      // skip malformed tail lines (e.g. a half-written last line)
    }
  }
  return messages;
}

// Parse a page snapshot tree (Aside toolResult text) into a page descriptor.
export function parseSnapshotText(text) {
  if (typeof text !== "string") return null;
  const page = {};
  const urlM =
    text.match(/\[url=([^\]\s]+)\]/) ||
    // openTab result echoes the url in parens: "page → title (chrome-error://…)"
    text.match(/\((chrome-error:\/\/[^)\s]+|edge-error:\/\/[^)\s]+)\)/);
  if (urlM) page.url = urlM[1];
  const titleM = text.match(/- title: "([^"]+)"/);
  if (titleM) page.title = titleM[1];
  const headM = text.match(/- heading "([^"]+)" \[level=1\]/);
  if (headM) page.heading = headM[1];
  const links = [...text.matchAll(/- link "([^"]+)"/g)].map((m) => m[1]);
  const textboxes = [...text.matchAll(/- textbox "([^"]+)"/g)].map((m) => m[1]);
  const buttons = [...text.matchAll(/- button "([^"]+)"/g)].map((m) => m[1]);
  if (links.length) page.links = links;
  if (textboxes.length) page.textboxes = textboxes;
  if (buttons.length) page.buttons = buttons;
  // ref -> durable {role,label} so leadsTo edges can name the control without
  // pinning an ephemeral eN
  const elementRefs = {};
  for (const m of text.matchAll(/- (link|button|textbox) "([^"]+)" \[ref=(e\d+)\]/g)) {
    elementRefs[m[3]] = { role: m[1], label: m[2] };
  }
  page.elementRefs = elementRefs;
  return page.url || page.title ? page : null;
}

// Pull browser actions out of one repl code string, in execution order.
export function parseReplCode(code) {
  const acts = [];
  if (typeof code !== "string") return acts;
  const re =
    /openTab\s*\(\s*['"`]([^'"`]+)['"`]|\.goto\s*\(\s*['"`]([^'"`]+)['"`]|locator\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*\.(click|fill|press|selectOption)\s*\(\s*(['"`]([^'"`]*)['"`])?|page\s*\.locator\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*\.(click|fill|press|selectOption)\s*\(\s*(['"`]([^'"`]*)['"`])?|snapshot\s*\(|screenshot\s*\(|page\.evaluate\s*\(/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (m[1] || m[2]) {
      acts.push({ kind: "navigate", url: m[1] || m[2] });
    } else if (m[3]) {
      acts.push({ kind: m[4], selector: m[3], value: m[6] ?? null });
    } else if (m[7]) {
      acts.push({ kind: m[8], selector: m[7], value: m[10] ?? null });
    } else if (m[0].startsWith("screenshot")) {
      acts.push({ kind: "screenshot" });
    } else if (m[0].startsWith("page.evaluate")) {
      // a DOM-data read: fingerprint WHICH source the agent pulled from so a
      // repeat run can jump straight to it instead of rescanning the page.
      const near = code.slice(m.index, m.index + 400);
      let fp = null;
      for (const [pat, kind] of DATA_SOURCE_PATTERNS)
        if (pat.test(near)) { fp = kind; break; }
      if (fp) {
        const sm = near.match(
          /(__NEXT_DATA__|__NUXT__|__INITIAL_STATE__|__APOLLO_STATE__|__PRELOADED_STATE__|contentDocument|contentWindow|innerText|textContent|querySelector(?:All)?|getElementsBy\w+|localStorage|sessionStorage)((?:\.[A-Za-z_$][\w$]*){0,3})/
        );
        const src = sm
          ? sanitizeValue(sm[1] + (sm[2] || "")).slice(0, 48)
          : fp;
        acts.push({ kind: "eval", fingerprint: fp, source: src });
      }
    } else {
      acts.push({ kind: "snapshot" });
    }
  }
  return acts;
}

// data locations agents read via page.evaluate, most specific first
const DATA_SOURCE_PATTERNS = [
  [/__(?:NEXT_DATA|NUXT|INITIAL_STATE|APOLLO_STATE|PRELOADED_STATE)__/, "embedded-json"],
  [/contentDocument|contentWindow|iframe/i, "iframe"],
  [/innerText|textContent/i, "dom-text"],
  [/querySelector(?:All)?|getElementsBy(?:Tag|Class)Name/, "dom-query"],
  [/localStorage|sessionStorage/, "storage"],
];

// ---------- redaction ----------

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:\+?\d[\d\s-]{7,}\d)/g;
const CARD_RE = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g;
const SECRETISH_RE =
  /(password|passwd|비밀번호|token|apikey|api[_-]?key|secret|cvv|cvc|카드번호)/i;

export function sanitizeValue(s) {
  if (typeof s !== "string") return s;
  return s
    .replace(CARD_RE, "[redacted]")
    .replace(EMAIL_RE, "[redacted]")
    .replace(PHONE_RE, "[redacted]");
}

// For text that lands in a prompt-facing markdown file (MEMORY.md index,
// skill frontmatter descriptions). A hostile page heading could inject
// newlines/HTML comments to smuggle instructions into the next agent prompt.
export function sanitizeLabel(s) {
  if (typeof s !== "string") return s;
  return sanitizeValue(s)
    .replace(/<!--|-->/g, "") // strip comment markers, break TRAIL-BEGIN/END spoofing
    .replace(/[\r\n]+/g, " ")
    .replace(/^[\s#>*\-`]+/, "") // no leading markdown syntax
    .trim()
    .slice(0, 120);
}

export function sanitizeUrl(u) {
  try {
    const url = new URL(u);
    const keys = [...url.searchParams.keys()];
    const normPath = normalizePathname(url.pathname);
    if (keys.length) {
      // rebuild manually: url.searchParams re-encodes braces in values
      const qs = keys.map((k) => k + "=${" + k + "}").join("&");
      return url.origin + normPath + "?" + qs + (url.hash || "");
    }
    return url.origin + normPath + (url.hash || "");
  } catch {
    return u;
  }
}

// raw pathname — no normalization (identifier-safe reads like title matching)
export function urlPathOf(u) {
  try {
    return new URL(u).pathname;
  } catch {
    return null;
  }
}

// per-entity path segments → {name}: order/17103500095423 -> order/{orderId}.
// Only runs on the STORED path (never re-parsed through new URL — braces would
// percent-encode), so route/page keys are stable across different entities.
const SEG_LITERAL_RULES = [
  (s) => s.includes("%"), // percent-encoded slug
  (s) => !/\d/.test(s), // pure word: order, list, en-US
  (s) => /^\d{1,4}$/.test(s), // year/page: 2024, 10, 2
  (s) => /^v\d+(\.\d+)*$/i.test(s), // api version: v2, v1.2
  (s) => /^(19|20)\d{2}-?(0[1-9]|1[0-2])-?([0-2]\d|3[01])?$/.test(s), // 2024-10-09
  (s) => /\.[a-zA-Z]{2,5}$/.test(s) && !/\d{5,}/.test(s), // file-like: index.html
];
function isParamSegment(s) {
  if (SEG_LITERAL_RULES.some((rule) => rule(s))) return false;
  return (
    /\d{5,}/.test(s) || // long digit run: order ids
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ||
    /^[0-9a-f]{16,}$/i.test(s) || // hex token
    (/^[A-Za-z0-9_-]{10,}$/.test(s) && /[A-Za-z]/.test(s) && /\d/.test(s)) // ASIN
  );
}
function camelFrom(s) {
  const c = s.replace(/[-_]+(.)/g, (_, ch) => ch.toUpperCase()).replace(/^(.)/, (ch) => ch.toLowerCase());
  return /^[a-z][a-zA-Z0-9]*$/.test(c) ? c : null;
}
export function normalizePathname(pn) {
  if (typeof pn !== "string") return pn;
  const segs = pn.split("/");
  let n = 0;
  return segs
    .map((s, i) => {
      if (!isParamSegment(s)) return s;
      for (let j = i - 1; j >= 0; j--) {
        const prev = segs[j];
        if (!prev || isParamSegment(prev)) continue;
        const base = camelFrom(prev);
        if (base) return "{" + base + "Id}";
        break;
      }
      return "{id" + (++n > 1 ? n : "") + "}";
    })
    .join("/");
}
// routing form: normalized pathname used for pages/routes/shortcuts
export function routePathOf(u) {
  const p = urlPathOf(u);
  return p ? normalizePathname(p) : null;
}

export function hostOf(u) {
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
}

// ---------- extraction ----------

// Full extract from one transcript file:
// { sessionId, dir, userPrompt, sites: { host: { steps, firstTotal, lastTotal, replCalls } }, totals }
export async function extractSession(file) {
  const messages = await parseMessagesJsonl(file);
  const dir = path.basename(path.dirname(file));
  // Aside dirs look like 2026-10-09_<id>; fall back to the filename stem.
  const sessionId = dir.includes("_")
    ? dir.split("_").pop()
    : path.basename(file).replace(/\.messages\.jsonl$|\.jsonl$/, "");
  const extracted = {
    sessionId,
    dir,
    file,
    userPrompt: "",
    sites: {},
    totals: { firstTotal: 0, lastTotal: 0, replCalls: 0 },
  };

  const resultByCallId = new Map();
  for (const msg of messages) {
    if (msg.usage) {
      if (!extracted.totals.firstTotal)
        extracted.totals.firstTotal = msg.usage.totalTokens ?? 0;
      extracted.totals.lastTotal = msg.usage.totalTokens ?? extracted.totals.lastTotal;
    }
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    for (const c of blocks) {
      if (msg.role === "user" && c.type === "text" && c.text && !extracted.userPrompt) {
        extracted.userPrompt = c.text;
      }
      if (c.type === "toolResult" && c.toolCallId) {
        const text = Array.isArray(c.content)
          ? c.content.map((x) => x.text || "").join("\n")
          : c.text || "";
        resultByCallId.set(c.toolCallId, text);
      }
    }
  }
  // Aside transcripts pair toolCall→result by ADJACENCY: a toolResult line is
  // {role:"toolResult",content:[{type:"text",text:...}]} with no call id.
  // Queue every toolResult text in file order; each toolCall takes the next one.
  const orphanResults = [];
  for (const msg of messages) {
    if (msg.role !== "toolResult") continue;
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    for (const c of blocks) {
      if (c.toolCallId) continue; // already in resultByCallId
      const text = Array.isArray(c.content)
        ? c.content.map((x) => x.text || "").join("\n")
        : c.text || "";
      if (text) orphanResults.push(text);
    }
  }

  let currentHost = null;
  const pushStep = (host, step) => {
    if (!host) return;
    const site = (extracted.sites[host] ??= { steps: [] });
    site.steps.push(step);
  };

  for (const msg of messages) {
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    for (const c of blocks) {
      if (c.type !== "toolCall" && c.type !== "tool_call") continue;
      const name = c.name;
      let args = c.arguments || c.input || {};
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      const resultText =
        (c.id && resultByCallId.get(c.id)) ?? orphanResults.shift() ?? "";
      const page = parseSnapshotText(resultText);
      const pageHost = page?.url ? hostOf(page.url) : null;

      if (name === "read_file" && /SKILL\.md|memory\.md/.test(args.path || "")) {
        pushStep(currentHost || (pageHost ?? "unknown"), {
          kind: "skill-read",
          path: args.path,
        });
        continue;
      }
      if (name !== "repl") continue;

      extracted.totals.replCalls++;
      const acts = parseReplCode(args.code || "");
      for (const [i, act] of acts.entries()) {
        if (act.kind === "navigate") {
          const h = hostOf(act.url);
          if (h) currentHost = h;
          // a navigate that landed on a browser error page (404, DNS fail)
          // teaches nothing — don't record its path as a route step.
          const failed =
            !!page?.url && /^(chrome-error:|edge-error:|about:blank)/.test(page.url);
          pushStep(currentHost, {
            kind: "navigate",
            url: sanitizeUrl(act.url),
            urlPath: routePathOf(act.url),
            failed,
          });
        } else if (act.kind === "click" || act.kind === "press" || act.kind === "selectOption") {
          // the result page of this call may live on ANOTHER host (a nav link
          // click www→mc): stamp the path only when it stayed in-host, else
          // the source host "visits" a path that isn't its own. Cross-host
          // landings become a leadsTo edge on the SOURCE site instead.
          const stepHost = currentHost || pageHost;
          const sameHost = !!(pageHost && pageHost === stepHost);
          // last nav-causing act in this repl owns the result page (a trailing
          // snapshot()/screenshot() doesn't change where we landed)
          const NAV_ACTS = new Set(["navigate", "openTab", "click", "press", "selectOption", "fill", "type"]);
          const isLastAct = !acts.slice(i + 1).some((a) => NAV_ACTS.has(a.kind));
          const errHost = pageHost && /chromewebdata|^chrome\.|^edge\.|^devtools$|^about$/.test(pageHost);
          const errPage = page?.url && /^(chrome-error:|edge-error:|about:blank)/.test(page.url);
          const lead =
            isLastAct && currentHost && pageHost && pageHost !== currentHost &&
            !errHost && !errPage && page.url
              ? { toHost: pageHost, toPath: routePathOf(page.url) }
              : null;
          // resolve an eN ref to a durable "role \"label\"" from the SOURCE
          // host's last snapshot — refs die next snapshot.
          let durable = null;
          if (act.selector && /^e\d+$/.test(act.selector)) {
            const lp = extracted.sites[currentHost]?.lastPage;
            const hit = lp?.elementRefs?.[act.selector];
            if (hit) durable = `${hit.role} "${sanitizeLabel(hit.label)}"`;
          } else if (act.selector) durable = sanitizeLabel(act.selector) || null;
          const fromPage =
            [...(extracted.sites[currentHost]?.steps || [])]
              .reverse()
              .find((s) => !s.failed && (s.pageUrl || s.urlPath))
              ?.pageUrl || null;
          pushStep(stepHost, {
            kind: act.kind,
            selector: act.selector,
            pageUrl: sameHost ? routePathOf(page.url) : null,
            leadsTo: lead
              ? { fromPage, selector: durable, toHost: lead.toHost, toPath: lead.toPath }
              : undefined,
          });
        } else if (act.kind === "fill") {
          // resolve the field's label from the LAST seen page snapshot when the
          // selector is a ref (eN); never store the typed value.
          const field = act.selector && /^e\d+$/.test(act.selector) ? null : act.selector;
          const stepHost = currentHost || pageHost;
          const sameHost = !!(pageHost && pageHost === stepHost);
          pushStep(stepHost, {
            kind: "fill",
            selector: act.selector,
            fillField: field ? sanitizeValue(field) : null,
            pageUrl: sameHost ? routePathOf(page.url) : null,
            // value intentionally dropped
          });
          act._fillValue = true;
        } else if (act.kind === "eval") {
          // a page.evaluate data read: attach it to the page it ran on so a
          // repeat agent can jump to the same source instead of rescanning.
          const evalHost = currentHost || pageHost;
          const evalSameHost = !!(pageHost && pageHost === evalHost);
          const lastSteps = extracted.sites[evalHost]?.steps || [];
          const lastPageUrl = [...lastSteps]
            .reverse()
            .find((s) => s.pageUrl)?.pageUrl;
          const pageUrl =
            (evalSameHost && page ? routePathOf(page.url) : null) ??
            lastPageUrl ??
            null;
          const ok =
            resultText != null &&
            !/^\s*(undefined|null|\[\]|\{\}|""|''|Error|TypeError|ReferenceError|Evaluation failed)/.test(
              resultText
            );
          pushStep(evalHost || "unknown", {
            kind: "eval",
            fingerprint: act.fingerprint,
            source: act.source,
            ok,
            pageUrl,
          });
        } else {
          pushStep(currentHost || pageHost, { kind: act.kind });
        }
      }
      // attach the resulting page snapshot to the site
      if (page && page.url) {
        const h = hostOf(page.url);
        if (h) {
          currentHost = h;
          const site = (extracted.sites[h] ??= { steps: [] });
          const p = routePathOf(page.url);
          const last = site.steps[site.steps.length - 1];
          if (last) {
            last.pageUrl = last.pageUrl ?? p;
            last.pageTitle = page.title ?? null;
            last.pageHeading = page.heading ?? null;
          } else {
            site.steps.push({
              kind: "page",
              urlPath: p,
              pageTitle: page.title ?? null,
              pageHeading: page.heading ?? null,
            });
          }
          site.lastPage = page;
        }
      }
    }
  }
  return extracted;
}

export function stepsByHost(steps) {
  const out = {};
  for (const s of steps) {
    const h = s.host || "unknown";
    (out[h] ??= []).push(s);
  }
  return out;
}

// ---------- storage ----------

export async function loadJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

export async function saveJson(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  // 0600: state.json stores the user's request text (160c) — never world/group-readable
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}

export async function loadConfig(home) {
  return (
    (await loadJson(path.join(home, "config.json"))) ?? {
      enabled: true,
      emit: true,
      accountRoot: DEFAULT_ACCOUNT_ROOT,
    }
  );
}

export async function saveConfig(home, cfg) {
  await saveJson(path.join(home, "config.json"), cfg);
}

export function siteSlug(host) {
  return String(host)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function memoryPath(home, host) {
  return path.join(home, "sites", siteSlug(host), "memory.json");
}

export function skillDir(accountRoot, host) {
  return path.join(accountRoot, "skills", "user", `trail-${siteSlug(host)}`);
}

function nowIso() {
  return new Date().toISOString();
}

// ---------- distill ----------

// merge extracted session steps into per-site memory, emit skills.
export async function distillFlows(home, extracted) {
  const cfg = await loadConfig(home);
  const results = [];
  for (const [host, site] of Object.entries(extracted.sites || {})) {
    if (host === "unknown") continue;
    // browser error pages are not sites — skip chromewebdata & friends
    if (/chromewebdata|^chrome\.|^edge\.|^devtools$|^about$/.test(host)) continue;
    const memFile = memoryPath(home, host);
    const mem =
      (await loadJson(memFile)) ?? {
        schema: 1,
        host,
        updatedAt: nowIso(),
        sessions: [],
        pages: {},
        routes: [],
        leadsTo: [],
        corrections: [],
        notes: [],
      };
    mem.leadsTo ??= [];
    mem.updatedAt = nowIso();
    if (!mem.sessions.includes(extracted.sessionId))
      mem.sessions.push(extracted.sessionId);

    // pages: record visits + elements
    const visit = [];
    for (const st of site.steps) {
      // cross-host landing the click produced: record on the SOURCE site as
      // a leadsTo edge — never as a route step (the target host owns it)
      if (st.leadsTo && st.leadsTo.toHost && st.leadsTo.toHost !== host) {
        const lt = st.leadsTo;
        const key = `${lt.fromPage || ""}::${lt.selector || ""}::${lt.toHost}::${lt.toPath}`;
        const ex = mem.leadsTo.find((e) => e.key === key);
        if (ex) {
          ex.seen++;
          ex.lastSeen = nowIso();
        } else {
          mem.leadsTo.push({
            key,
            fromPage: lt.fromPage || null,
            selector: lt.selector || null,
            toHost: lt.toHost,
            toPath: lt.toPath,
            seen: 1,
            lastSeen: nowIso(),
            evidence: `session ${extracted.sessionId}`,
          });
        }
      }
      if (st.failed) continue; // dead-end navigation — never a route step
      const p = st.urlPath || st.pageUrl;
      if (!p) continue;
      if (!visit.includes(p)) visit.push(p);
      if (st.pageUrl) {
        const pg = (mem.pages[st.pageUrl] ??= { count: 0, elements: {} });
        pg.count++;
        if (st.pageTitle) pg.title = st.pageTitle;
        if (st.pageHeading) pg.heading = st.pageHeading;
      }
      // merge element labels from the session's lastPage snapshots
      if (site.lastPage && st.pageUrl === routePathOf(site.lastPage.url)) {
        const pg = (mem.pages[st.pageUrl] ??= { count: 0, elements: {} });
        pg.elements = pg.elements || {};
        for (const [k, arr] of Object.entries({
          link: site.lastPage.links,
          textbox: site.lastPage.textboxes,
          button: site.lastPage.buttons,
        })) {
          if (!arr) continue;
          const set = new Set([...(pg.elements[k] || []), ...arr.map(sanitizeValue)]);
          pg.elements[k] = [...set];
        }
      }
      if (st.fillField) {
        const pg = (mem.pages[st.pageUrl || "unknown"] ??= { count: 0, elements: {} });
        pg.elements = pg.elements || {};
        const set = new Set([...(pg.elements.textbox || []), st.fillField]);
        pg.elements.textbox = [...set];
      }
      if (st.kind === "eval" && st.ok && st.pageUrl && st.fingerprint) {
        // dataHints: which source on this page yielded data — repeat agents
        // read it directly instead of rescanning the DOM.
        const pg = (mem.pages[st.pageUrl] ??= { count: 0, elements: {} });
        pg.dataHints ??= [];
        const key = `${st.fingerprint}:${(st.source || st.fingerprint).toLowerCase().replace(/[\s'"]+/g, "")}`;
        const ex = pg.dataHints.find((h) => h.key === key);
        if (ex) {
          ex.hits++;
          ex.lastSeen = nowIso();
        } else {
          pg.dataHints.push({
            key,
            kind: st.fingerprint,
            source: st.source || st.fingerprint,
            hits: 1,
            lastSeen: nowIso(),
            evidence: `session ${extracted.sessionId}`,
          });
        }
        pg.dataHints.sort((a, b) => b.hits - a.hits || b.lastSeen.localeCompare(a.lastSeen));
        pg.dataHints = pg.dataHints.slice(0, 3);
      }
    }

    // route: visit path ending at the last page of the session
    if (visit.length) {
      const endPath = visit[visit.length - 1];
      const shortcut =
        visit.length >= 2 ? visit[visit.length - 1] : null; // last stable path
      const preCompletion = endPath.startsWith("/done")
        ? visit.slice(0, -1)
        : visit;
      // a parameterized path ({orderId}) is a template, not an openable URL —
      // the shortcut is the last LITERAL path on the route
      const literalSteps = preCompletion.filter((p) => !/[{}]/.test(p));
      const lastStable = literalSteps.length ? literalSteps[literalSteps.length - 1] : null;
      const key = endPath.split("?")[0] + "::" + (site.lastPage?.heading || "");
      const existing = mem.routes.find((r) => r.key === key || samePath(r.steps, preCompletion));
      // label = the TASK page heading (last page before the completion page),
      // not the completion heading — agents match skills on task wording.
      const taskPath = lastStable || endPath;
      const taskHeading = Object.entries(mem.pages).find(
        ([p]) => p === taskPath
      )?.[1]?.heading;
      const label =
        (taskHeading ? sanitizeLabel(taskHeading) : null) ||
        preCompletion[preCompletion.length - 1] ||
        endPath;
      if (existing) {
        existing.seen++;
        existing.success++;
        existing.lastSeen = nowIso();
        if (taskHeading && existing.label !== sanitizeLabel(taskHeading))
          existing.label = sanitizeLabel(taskHeading) || label;
        if (lastStable && existing.shortcut && existing.shortcut !== lastStable) {
          mem.corrections.push({
            at: nowIso(),
            what: `shortcut ${existing.shortcut} -> ${lastStable}`,
            evidence: `session ${extracted.sessionId}`,
          });
          existing.shortcut = lastStable;
        }
        if (!existing.shortcut && lastStable) existing.shortcut = lastStable;
      } else {
        mem.routes.push({
          key,
          label,
          steps: visit,
          shortcut: lastStable,
          seen: 1,
          success: 1,
          lastSeen: nowIso(),
        });
      }
    }

    await saveJson(memFile, mem);
    let emitted = null;
    if (cfg.emit !== false && cfg.enabled !== false) {
      emitted = await emitSkill(home, cfg.accountRoot || DEFAULT_ACCOUNT_ROOT, host);
      await syncAsideMemory(home, cfg.accountRoot || DEFAULT_ACCOUNT_ROOT);
    }
    results.push({ host, memory: memFile, emitted });
  }
  return results;
}

function samePath(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

// ---------- skill emission ----------

function rand6() {
  return createHash("sha1")
    .update(String(Math.random()) + Date.now())
    .digest("hex")
    .slice(0, 6)
    .toUpperCase();
}

export async function emitSkill(home, accountRoot, host) {
  const mem = await loadJson(memoryPath(home, host));
  if (!mem) throw new Error(`no site memory for ${host}`);
  const slug = siteSlug(host);
  const dir = skillDir(accountRoot, host);
  const title =
    Object.values(mem.pages).find((p) => p.title)?.title || host;
  const origin = `http://${host}`;
  const labels = mem.routes.map((r) => r.label).slice(0, 3).join(", ");
  const marker = `TRAIL-${rand6()}`;

  const skillMd = `---
name: "trail-${slug}"
siteSpecific: true
description: "Use saved navigation experience for ${escapeYaml(labels || "recorded")} tasks on ${escapeYaml(title)} at ${origin}. Applies automatically when working on this site."
autoInject:
  url: ["${host}"]
---
Read references/memory.md before browsing ${host}. Open the learned shortcut directly; if its page title and path match memory, read the answer from that first snapshot and skip a second verification pass. Otherwise navigate normally. If a "Where the data lives" entry names a source on the page you're on, read it with page.evaluate before scanning the DOM. A Template line is not a shortcut: never open a URL that still contains "{" or "}". Requested values (recipient, text, quantity, option, price) come only from the current request — never from memory. Verify completion by the final page's heading or result, not by re-exploring. Mention the memory provenance marker only if you actually read and used the memory.
`;

  const lines = [];
  lines.push("# Observed site workflow");
  lines.push("");
  lines.push(`Site: ${title} (${origin})`);
  lines.push(`Last updated: ${mem.updatedAt}`);
  lines.push(`Observed in sessions: ${mem.sessions.join(", ")}`);
  lines.push("");
  lines.push("## Pages observed");
  lines.push("");
  // element names the learned steps actually use — keep selector-referenced
  // names, then cap the rest at 6 so a page dump stays small (dataHints now
  // carry the 'where the answer was' signal these lists were a proxy for).
  const usedLabels = new Set();
  for (const e of mem.leadsTo || []) {
    const sm = (e.selector || "").match(/"([^"]+)"/);
    if (sm) usedLabels.add(sm[1]);
  }
  const keepTrim = (arr) => {
    const seen = new Set();
    const used = [], rest = [];
    for (const v of arr || []) {
      if (seen.has(v)) continue;
      seen.add(v);
      (usedLabels.has(v) ? used : rest).push(v);
    }
    return used.concat(rest.slice(0, 6));
  };
  for (const [p, pg] of Object.entries(mem.pages)) {
    lines.push(`- ${p} — ${pg.heading || pg.title || "(page)"} (seen ${pg.count}x)`);
    const bits = [];
    const t = keepTrim(pg.elements?.textbox);
    const b = keepTrim(pg.elements?.button);
    const l = keepTrim(pg.elements?.link);
    if (t.length) bits.push(`inputs: ${t.join(", ")}`);
    if (b.length) bits.push(`buttons: ${b.join(", ")}`);
    if (l.length) bits.push(`links: ${l.join(", ")}`);
    if (bits.length) lines.push(`  - Elements: ${bits.join(" | ")}`);
  }
  lines.push("");
  lines.push("## Learned routes");
  lines.push("");
  const isTemplate = (p) => /[{}]/.test(p || "");
  const hintOf = (name) => {
    const words = name.replace(/Id$/, "").replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    return "the " + (words || name);
  };
  for (const r of mem.routes) {
    lines.push(`- ${r.label}: ${r.steps.join(" -> ")}`);
    if (r.shortcut && !isTemplate(r.shortcut)) {
      lines.push(`  - Shortcut: open ${origin}${r.shortcut} directly instead of walking the intermediate pages.`);
    }
    // parameterized paths are templates — never a Shortcut line, and never
    // print the observed entity value (an agent would open it verbatim)
    for (const step of r.steps) {
      if (!isTemplate(step)) continue;
      const holes = [...step.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]);
      const subs = holes.map((h) => `Substitute {${h}} with ${hintOf(h)}`).join("; ");
      lines.push(`  - Template: do not open as written. ${subs}, then open only the filled URL. Pattern: ${origin}${step}. Never open a URL that still contains "{" or "}".`);
    }
    lines.push(`  - Seen ${r.seen}x, verified ${r.success}x, last ${r.lastSeen}`);
  }
  // dataHints: which source on a page held the answer — read it directly
  // instead of rescanning the DOM.
  const hintPages = Object.entries(mem.pages).filter(
    ([, pg]) => pg.dataHints?.length
  );
  if (hintPages.length) {
    lines.push("");
    lines.push("## Where the data lives");
    lines.push("");
    let emitted = 0;
    for (const [p, pg] of hintPages) {
      for (const h of pg.dataHints) {
        if (emitted >= 8) break;
        emitted++;
        lines.push(
          `- \`${p}\` — the answer was in \`${h.source}\`. Read it with page.evaluate on that source instead of rescanning the DOM. Seen ${h.hits}x, last ${h.lastSeen.slice(0, 10)}.`
        );
      }
    }
    lines.push("");
  }
  if (mem.leadsTo?.length) {
    lines.push("");
    lines.push("## Cross-site links");
    for (const e of mem.leadsTo.slice(0, 8)) {
      const roleLabel = e.selector?.match(/^(link|button|textbox) "(.+)"$/);
      const src = roleLabel ? `${roleLabel[2]} ${roleLabel[1]}` : e.selector || `page ${e.fromPage || "/"}`;
      lines.push(`- ${src} leads to ${e.toHost}${e.toPath}.`);
    }
  }
  if (mem.corrections.length) {
    lines.push("");
    lines.push("## Corrections");
    for (const c of mem.corrections.slice(-5)) lines.push(`- ${c.at}: ${c.what}`);
  }
  lines.push("");
  lines.push("## What memory does not cover");
  lines.push("");
  lines.push("- Requested values (recipient, text, quantity, options): read them from the request, never from memory.");
  lines.push("- Element refs and labels: take them from the first live snapshot. If a shortcut's page title and path match memory, that snapshot is enough — read the answer from it and do not re-derive it by rescanning the DOM or clicking controls.");
  lines.push("- Shortcut lands on an unexpected page (404, login wall, changed layout): navigate normally from there.");
  lines.push("- \"{\" or \"}\" in a path is a placeholder, not an address. Substitute the named value, then open the result; if you lack the value, open the stable page that leads there and read it on the page.");
  lines.push("- Data locations shift with redesigns — if a remembered source returns undefined/null, scan the live page.");
  lines.push("");
  lines.push(`Memory provenance marker: ${marker}.`);
  lines.push("");

  await fs.mkdir(path.join(dir, "references"), { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), skillMd);
  await fs.writeFile(path.join(dir, "references", "memory.md"), lines.join("\n"));
  return dir;
}

function escapeYaml(s) {
  return String(s).replace(/"/g, '\\"');
}

// ---------- Aside memory bridge ----------

// `aside exec` sessions load memory/MEMORY.md into the prompt. User skills are
// NOT surfaced there — so the reuse channel is a thin registry section in
// MEMORY.md pointing at per-site files under memory/sites/trail-<slug>.md.
// Markers let us rewrite just our block without touching the user's notes.
const MEM_BEGIN = "<!-- TRAIL-BEGIN";
const MEM_END = "<!-- TRAIL-END";

export async function syncAsideMemory(home, accountRoot) {
  const memDir = path.join(accountRoot, "memory");
  const memFile = path.join(memDir, "MEMORY.md");
  const sitesDir = path.join(home, "sites");
  const dirs = await fs.readdir(sitesDir, { withFileTypes: true }).catch(() => []);
  const entries = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const mem = await loadJson(path.join(sitesDir, d.name, "memory.json"));
    if (!mem?.host || (!mem.routes?.length && !mem.leadsTo?.length)) continue;
    const title =
      Object.values(mem.pages || {}).find((p) => p.title)?.title || mem.host;
    const labels = (mem.routes || []).map((r) => r.label).join(", ");
    // per-site detail file in Aside's own memory tree
    const siteFile = path.join(memDir, "sites", `trail-${siteSlug(mem.host)}.md`);
    await fs.mkdir(path.dirname(siteFile), { recursive: true });
    // compact: the agent only needs the route + where the data lives.
    // Prose and boilerplate stripped — this file is loaded per-request.
    const routeLines = (mem.routes || []).map(
      (r) =>
        `- ${r.label}: shortcut: open ${r.shortcut}` +
        (/[{}]/.test(r.shortcut || "") ? " — template, substitute the named value first" : "")
    );
    const dataLines = Object.entries(mem.pages || {})
      .filter(([, pg]) => pg.dataHints?.length)
      .flatMap(([p, pg]) =>
        pg.dataHints.map((h) => `- ${p}: read \`${h.source}\` via page.evaluate`)
      )
      .slice(0, 8);
    const body = [
      `# ${mem.host} — trail memory`,
      `Guide: skills/user/trail-${siteSlug(mem.host)}/references/memory.md`,
      "",
      ...routeLines,
      ...(mem.leadsTo?.length
        ? [
            "",
            ...mem.leadsTo.slice(0, 5).map((e) => {
              const m = e.selector?.match(/^(link|button|textbox) "(.+)"$/);
              const src = m ? `${m[2]} ${m[1]}` : e.selector || `page ${e.fromPage || "/"}`;
              return `- ${src} → ${e.toHost}${e.toPath}`;
            }),
          ]
        : []),
      ...(dataLines.length ? ["", "Data:", ...dataLines] : []),
      "",
      "Rules: open shortcut directly; if title/path match, answer from that snapshot. Values come from the request, not memory. If it lands wrong, navigate normally; correction records on next ingest.",
      "",
    ].join("\n");
    await fs.writeFile(siteFile, body);
    // never emit a template as an openable Shortcut — only literal paths
    // index row: the signal the agent needs is "this host has a shortcut".
    // Keep it one short line — full details live in the site file / skill.
    const first = (mem.routes || []).find((r) => r.shortcut && !/[{}]/.test(r.shortcut));
    entries.push(
      `- ${mem.host} → ${first?.shortcut || Object.keys(mem.pages || {})[0] || "/"} · memory/sites/trail-${siteSlug(mem.host)}.md`
    );
  }
  const block =
    `${MEM_BEGIN} -- managed by Trail, edits will be overwritten -->\n` +
    `## Trail: learned site shortcuts\n` +
    `If the target host appears below, open the shortcut directly instead of navigating. Details per host: memory/sites/trail-<host>.md.\n` +
    (entries.length ? entries.join("\n") : `- (nothing learned yet)`) +
    `\n${MEM_END} -->`;
  let cur = "";
  try {
    cur = await fs.readFile(memFile, "utf8");
  } catch {}
  const re = new RegExp(`${MEM_BEGIN}[^]*?${MEM_END} -->`);
  // prepend: the index must come FIRST in MEMORY.md, not buried at the tail
  const next = re.test(cur)
    ? cur.replace(re, block)
    : block + "\n\n" + cur.trimStart();
  await fs.writeFile(memFile, next);
  return entries.length;
}

export async function unsyncAsideMemory(home, accountRoot, host) {
  const siteFile = path.join(
    accountRoot,
    "memory",
    "sites",
    `trail-${siteSlug(host)}.md`
  );
  await fs.rm(siteFile, { force: true });
  await syncAsideMemory(home, accountRoot);
}

// `trail off`: strip our whole index block + site files so nothing is reused.
export async function disableAsideMemory(accountRoot) {
  const memDir = path.join(accountRoot, "memory");
  const memFile = path.join(memDir, "MEMORY.md");
  const sitesDir = path.join(memDir, "sites");
  let files = [];
  try {
    files = await fs.readdir(sitesDir);
  } catch {}
  for (const f of files) {
    if (f.startsWith("trail-") && f.endsWith(".md"))
      await fs.rm(path.join(sitesDir, f), { force: true });
  }
  let cur = "";
  try {
    cur = await fs.readFile(memFile, "utf8");
  } catch {
    return;
  }
  const re = new RegExp(`\\n*${MEM_BEGIN}[^]*?${MEM_END} -->\\n?`);
  await fs.writeFile(memFile, cur.replace(re, "\n"));
}

// ---------- background daemon (launchd on macOS, nohup elsewhere) ----------

export const LAUNCHD_LABEL = "com.trail.watch";
export function launchdPlistPath() {
  return path.join(
    os.homedir(),
    "Library",
    "LaunchAgents",
    `${LAUNCHD_LABEL}.plist`
  );
}

export function buildLaunchdPlist(home) {
  const cli = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "bin",
    "trail.js"
  );
  const log = path.join(home, "watch.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${cli}</string>
    <string>watch</string>
    <string>--home</string><string>${home}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict>
</plist>
`;
}

export async function daemonStatus(home) {
  const plist = launchdPlistPath();
  const installed = await fs.access(plist).then(() => true, () => false);
  let pid = null;
  try {
    const st = await loadJson(path.join(home, "watch.pid"));
    if (st?.pid) {
      process.kill(st.pid, 0);
      pid = st.pid;
    }
  } catch {}
  return { installed, pid, plist };
}

// ---------- ingest + scan ----------

export async function ingestFile(home, file, opts = {}) {
  const extracted = await extractSession(file);
  // remember processed offset for idempotent watch
  const stateFile = path.join(home, "state.json");
  const state = (await loadJson(stateFile)) ?? { sessions: {} };
  const stat = await fs.stat(file).catch(() => null);
  const size = stat ? stat.size : 0;
  const rec = state.sessions[extracted.sessionId];
  const fresh = Boolean(!rec || size > (rec.bytes || 0) || opts.force);
  let results = [];
  if (fresh) {
    results = await distillFlows(home, extracted);
  }
  state.sessions[extracted.sessionId] = {
    dir: extracted.dir,
    bytes: size,
    ingestedAt: nowIso(),
    deltaTotalTokens:
      (extracted.totals.lastTotal || 0) - (extracted.totals.firstTotal || 0),
    replCalls: extracted.totals.replCalls,
    sites: Object.keys(extracted.sites || {}),
    userPrompt: (extracted.userPrompt || "").slice(0, 160),
  };
  await saveJson(stateFile, state);
  return { sessionId: extracted.sessionId, fresh, results };
}

// Mark every existing session as seen at install time so `watch` only learns
// from work that happens AFTER `trail init`. Manual `ingest` still backfills.
export async function seedSessions(home, accountRoot) {
  const sessDir = path.join(accountRoot, "sessions");
  const stateFile = path.join(home, "state.json");
  const state = (await loadJson(stateFile)) ?? { sessions: {} };
  let entries = [];
  try {
    entries = await fs.readdir(sessDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let n = 0;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const f = path.join(sessDir, e.name, "messages.jsonl");
    const id = e.name.split("_").pop();
    if (state.sessions[id]) continue;
    const stat = await fs.stat(f).catch(() => null);
    state.sessions[id] = { dir: e.name, bytes: stat ? stat.size : 0, seeded: true };
    n++;
  }
  await saveJson(stateFile, state);
  return n;
}

export async function scanSessions(home, accountRoot) {
  const sessDir = path.join(accountRoot, "sessions");
  let entries = [];
  try {
    entries = await fs.readdir(sessDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const f = path.join(sessDir, e.name, "messages.jsonl");
    try {
      await fs.access(f);
      files.push(f);
    } catch {
      // no transcript in this session dir
    }
  }
  const out = [];
  for (const f of files) out.push(await ingestFile(home, f));
  return out;
}

// (see seedSessions above for install-time baseline)

// ---------- report ----------

export async function report(home) {
  const state = (await loadJson(path.join(home, "state.json"))) ?? { sessions: {} };
  const rows = Object.entries(state.sessions)
    .filter(([, s]) => !s.seeded)
    .map(([id, s]) => ({
    session: id,
    sites: (s.sites || []).join(","),
    replCalls: s.replCalls ?? 0,
    deltaTokens: s.deltaTotalTokens ?? 0,
    ingestedAt: s.ingestedAt,
    prompt: s.userPrompt || "",
  }));
  rows.sort((a, b) => String(a.ingestedAt).localeCompare(String(b.ingestedAt)));
  return rows;
}
