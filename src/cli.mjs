// Trail CLI: thin dispatch over src/core.mjs. No dependencies.
import { spawn, execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as core from "./core.mjs";

const execFileP = promisify(execFile);

const USAGE = `trail — automatic browsing-experience memory for Aside

Usage: trail <command> [options]      (or: node bin/trail.js <command>)

Commands:
  init                      Install Trail: create ~/.trail, write config,
                            install the Aside controller skill
  ingest <messages.jsonl>   Record one Aside session transcript now
  watch [--once] [--interval S]
                            Watch Aside sessions and learn continuously
                            (default interval 30s; --once scans a single pass)
  start                     Run watch in the background permanently
                            (launchd on macOS: survives logout, auto-restarts)
  stop                      Stop the background watcher
  status                    Show whether the background watcher is running
  distill                   Re-emit site skills from saved memory
  list                      List sites Trail has learned
  show <host>               Print a site's memory JSON
  report                    Per-session token/step usage (effect measurement)
  forget <host>             Delete a site's memory and its emitted skill
  on                        Re-enable automatic learning + skill emission
  off                       Pause learning (emission stops; data kept)
  verify                    Self-check: config, sessions dir, write access

Options:
  --home <dir>              Trail state dir (default: $TRAIL_HOME or ~/.trail)
  --account-root <dir>      Aside account dir (default: ~/.aside/u/0)
`;

function parse(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[k] = next;
        i++;
      } else {
        args[k] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function resolveHome(args) {
  return path.resolve(String(args.home || core.defaultHome()));
}

async function resolveAccountRoot(args, home) {
  if (args["account-root"]) return path.resolve(String(args["account-root"]));
  const cfg = await core.loadConfig(home);
  return cfg.accountRoot;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parse(argv);
  const cmd = args._[0];
  const home = resolveHome(args);

  try {
    switch (cmd) {
      case undefined:
      case "--help":
      case "-h":
      case "help": {
        console.log(USAGE);
        return 0;
      }

      case "init": {
        await fs.mkdir(home, { recursive: true });
        const cfg = await core.loadConfig(home);
        const root = args["account-root"] != null
          ? path.resolve(String(args["account-root"]))
          : (cfg.accountRoot || path.join(process.env.HOME || "~", ".aside", "u", "0"));
        cfg.accountRoot = root;
        cfg.enabled = cfg.enabled !== false;
        cfg.emit = cfg.emit !== false;
        await core.saveConfig(home, cfg);
        const srcSkill = path.resolve(
          path.dirname(new URL(import.meta.url).pathname),
          "..",
          "skills",
          "trail"
        );
        const dest = path.join(root, "skills", "user", "trail");
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.rm(dest, { recursive: true, force: true });
        await fs.cp(srcSkill, dest, { recursive: true });
        const seeded = await core.seedSessions(home, root);
        console.log(`Trail installed.
  state:  ${home}
  config: ${path.join(home, "config.json")}
  skill:  ${dest}
  learns from Aside sessions under: ${path.join(root, "sessions")}
  existing sessions marked seen (${seeded}) — Trail learns from NEW work only

Nothing else to do — use Aside normally and Trail learns from completed work.
Manage with: trail list | show <host> | forget <host> | off | on | report`);
        return 0;
      }

      case "ingest": {
        const file = args._[1];
        if (!file) throw new Error("ingest needs a messages.jsonl path");
        const r = await core.ingestFile(home, path.resolve(file), {
          force: !!args.force,
        });
        if (!r.fresh) {
          console.log(`session ${r.sessionId}: already ingested (use --force)`);
          return 0;
        }
        for (const res of r.results) {
          console.log(
            `learned ${res.host} -> ${res.memory}${res.emitted ? `\n  skill: ${res.emitted}` : "\n  (skill emission off)"}`
          );
        }
        if (!r.results.length) console.log(`session ${r.sessionId}: no browser activity found`);
        return 0;
      }

      case "watch": {
        const accountRoot = await resolveAccountRoot(args, home);
        const once = !!args.once;
        const interval = Number(args.interval || 30) * 1000;
        const tick = async () => {
          const rs = await core.scanSessions(home, accountRoot);
          const n = rs.filter((r) => r.fresh).length;
          if (n) console.log(`[${new Date().toISOString()}] learned from ${n} session(s)`);
          return n;
        };
        if (once) {
          await tick();
          return 0;
        }
        console.log(`watching ${path.join(accountRoot, "sessions")} every ${interval / 1000}s — Ctrl+C to stop`);
        await tick();
        // the interval itself keeps the event loop alive — do NOT unref it
        // (unref + pending top-level await makes node exit 13 "unsettled await").
        setInterval(() => tick().catch((e) => console.error("watch error:", e.message)), interval);
        await new Promise(() => {});
        return 0;
      }

      case "start": {
        const st = await core.daemonStatus(home);
        if (st.pid) {
          console.log(`Trail watcher already running (pid ${st.pid}).`);
          return 0;
        }
        if (os.platform() === "darwin") {
          const plistPath = core.launchdPlistPath();
          await fs.mkdir(path.dirname(plistPath), { recursive: true });
          await fs.writeFile(plistPath, core.buildLaunchdPlist(home));
          try {
            await execFileP("launchctl", ["bootout", `gui/${process.getuid()}`, plistPath]);
          } catch {}
          await execFileP("launchctl", [
            "bootstrap",
            `gui/${process.getuid()}`,
            plistPath,
          ]);
          console.log(`Trail watcher started via launchd — survives terminal close and login.`);
          console.log(`  plist: ${plistPath}`);
          console.log(`  log:   ${path.join(home, "watch.log")}`);
          console.log(`  stop:  node bin/trail.js stop`);
          return 0;
        }
        // non-macOS: detached nohup-style child
        const cli = path.resolve(
          path.dirname(new URL(import.meta.url).pathname),
          "..",
          "bin",
          "trail.js"
        );
        const logFd = await fs.open(path.join(home, "watch.log"), "a");
        const child = spawn(
          process.execPath,
          [cli, "watch", "--home", home],
          { detached: true, stdio: ["ignore", logFd.fd, logFd.fd] }
        );
        child.unref();
        await fs.writeFile(
          path.join(home, "watch.pid"),
          JSON.stringify({ pid: child.pid, at: new Date().toISOString() })
        );
        await logFd.close();
        console.log(`Trail watcher started detached (pid ${child.pid}) — survives terminal close.`);
        console.log(`  log: ${path.join(home, "watch.log")}  stop: node bin/trail.js stop`);
        return 0;
      }

      case "stop": {
        const st = await core.daemonStatus(home);
        if (os.platform() === "darwin" && st.installed) {
          try {
            await execFileP("launchctl", [
              "bootout",
              `gui/${process.getuid()}`,
              st.plist,
            ]);
          } catch {}
          await fs.rm(st.plist, { force: true });
          console.log("Trail watcher stopped and launchd entry removed.");
          return 0;
        }
        if (st.pid) {
          try {
            process.kill(st.pid, "SIGTERM");
          } catch {}
          await fs.rm(path.join(home, "watch.pid"), { force: true });
          console.log(`Trail watcher (pid ${st.pid}) stopped.`);
          return 0;
        }
        console.log("Trail watcher is not running.");
        return 0;
      }

      case "status": {
        const st = await core.daemonStatus(home);
        const cfg = await core.loadConfig(home);
        console.log(`learning: ${cfg.enabled !== false ? "on" : "paused (trail off)"}`);
        console.log(
          `watcher:  ${st.pid ? `running (pid ${st.pid})` : st.installed ? "installed in launchd" : "not running"}`
        );
        console.log(`log:      ${path.join(home, "watch.log")}`);
        return 0;
      }

      case "distill": {
        const accountRoot = await resolveAccountRoot(args, home);
        const sitesDir = path.join(home, "sites");
        const dirs = await fs.readdir(sitesDir, { withFileTypes: true }).catch(() => []);
        let n = 0;
        for (const d of dirs) {
          if (!d.isDirectory()) continue;
          const mem = await core.loadJson(path.join(sitesDir, d.name, "memory.json"));
          if (!mem?.host) continue;
          const p = await core.emitSkill(home, accountRoot, mem.host);
          console.log(`emitted ${mem.host} -> ${p}`);
          n++;
        }
        await core.syncAsideMemory(home, accountRoot);
        console.log(`${n} skill(s) up to date`);
        return 0;
      }

      case "list": {
        const sitesDir = path.join(home, "sites");
        const dirs = await fs.readdir(sitesDir, { withFileTypes: true }).catch(() => []);
        const rows = [];
        for (const d of dirs) {
          if (!d.isDirectory()) continue;
          const mem = await core.loadJson(path.join(sitesDir, d.name, "memory.json"));
          if (!mem?.host) continue;
          rows.push({
            host: mem.host,
            routes: mem.routes?.length ?? 0,
            sessions: mem.sessions?.length ?? 0,
            updated: mem.updatedAt,
          });
        }
        if (!rows.length) {
          console.log("No sites learned yet. Use Aside normally — Trail records completed browsing work.");
          return 0;
        }
        for (const r of rows)
          console.log(`${r.host}  routes:${r.routes}  sessions:${r.sessions}  updated:${r.updated}`);
        return 0;
      }

      case "show": {
        const host = args._[1];
        if (!host) throw new Error("show needs a host (e.g. trail show 127.0.0.1:8769)");
        const mem = await core.loadJson(core.memoryPath(home, host));
        if (!mem) throw new Error(`no memory for ${host}`);
        console.log(JSON.stringify(mem, null, 2));
        return 0;
      }

      case "report": {
        const rows = await core.report(home);
        if (!rows.length) {
          console.log("No sessions ingested yet.");
          return 0;
        }
        console.log("session                replCalls  deltaTokens  sites");
        for (const r of rows)
          console.log(
            `${r.session.padEnd(22)} ${String(r.replCalls).padEnd(10)} ${String(r.deltaTokens).padEnd(12)} ${r.sites}`
          );
        return 0;
      }

      case "forget": {
        const host = args._[1];
        if (!host) throw new Error("forget needs a host");
        const accountRoot = await resolveAccountRoot(args, home);
        const siteDir = path.join(home, "sites", core.siteSlug(host));
        const skDir = core.skillDir(accountRoot, host);
        await fs.rm(siteDir, { recursive: true, force: true });
        await fs.rm(skDir, { recursive: true, force: true });
        await core.unsyncAsideMemory(home, accountRoot, host);
        console.log(`forgot ${host}: removed site memory, emitted skill, and the Aside-memory index entry`);
        return 0;
      }

      case "off": {
        const cfg = await core.loadConfig(home);
        cfg.enabled = false;
        cfg.emit = false;
        await core.saveConfig(home, cfg);
        const accountRoot = await resolveAccountRoot(args, home);
        await core.disableAsideMemory(accountRoot);
        console.log("Trail learning paused and its site index removed from Aside memory (data kept in ~/.trail). Re-enable with: trail on");
        return 0;
      }

      case "on": {
        const cfg = await core.loadConfig(home);
        cfg.enabled = true;
        cfg.emit = true;
        await core.saveConfig(home, cfg);
        const accountRoot = await resolveAccountRoot(args, home);
        await core.syncAsideMemory(home, accountRoot);
        console.log("Trail learning re-enabled; site index restored to Aside memory.");
        return 0;
      }

      case "verify": {
        const cfg = await core.loadConfig(home);
        const accountRoot = await resolveAccountRoot(args, home);
        const checks = [];
        const ok = async (name, fn) => {
          try {
            const v = await fn();
            checks.push([name, v === false ? "FAIL" : "ok"]);
          } catch (e) {
            checks.push([name, `FAIL ${e.message}`]);
          }
        };
        await ok("config", async () => !!cfg);
        await ok("home writable", async () => {
          await fs.mkdir(home, { recursive: true });
          const t = path.join(home, ".write-test");
          await fs.writeFile(t, "1");
          await fs.rm(t);
          return true;
        });
        await ok("sessions dir", async () => {
          const d = await fs.readdir(path.join(accountRoot, "sessions"));
          return d.length >= 0;
        });
        await ok("skills dir", async () => {
          await fs.access(path.join(accountRoot, "skills", "user"));
          return true;
        });
        for (const [n, s] of checks) console.log(`${s === "ok" ? "PASS" : "FAIL"} ${n} ${s === "ok" ? "" : s}`);
        const bad = checks.filter(([, s]) => s !== "ok");
        if (bad.length) throw new Error(`${bad.length} check(s) failed`);
        console.log("trail verify: all checks passed");
        return 0;
      }

      default:
        console.error(`unknown command: ${cmd}\n`);
        console.log(USAGE);
        return 2;
    }
  } catch (e) {
    console.error(`trail: ${e.message}`);
    return 1;
  }
}
