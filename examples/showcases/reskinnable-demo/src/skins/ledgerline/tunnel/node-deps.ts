import { execFile, spawn } from "node:child_process";
import { promises as fs, openSync, closeSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { MCP_PATH, extractTunnelUrl, TunnelError } from "./tunnel";
import type { CloudflaredProcess, TunnelDeps, TunnelState } from "./tunnel";

/**
 * The real side effects behind `TunnelDeps`: `ps`, `lsof`, cloudflared's
 * metrics endpoint, a state file, DNS-over-HTTPS and a detached child process.
 * Server-only; the route is the one caller.
 */

const run = promisify(execFile);

/** `$TMPDIR/ledgerline-demo/`: survives a server restart, gone after a reboot (as is the tunnel). */
const STATE_DIR = path.join(os.tmpdir(), "ledgerline-demo");
const statePath = (port: number) => path.join(STATE_DIR, `tunnel-${port}.json`);
export const tunnelLogPath = (port: number) =>
  path.join(STATE_DIR, `tunnel-${port}.log`);

/** `ps` output lines ("  123 /opt/homebrew/bin/cloudflared tunnel ...") to processes. */
export function parsePs(stdout: string): CloudflaredProcess[] {
  return stdout
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), command: m[2] }))
    .filter((p) => /(^|\/)cloudflared(\s|$)/.test(p.command));
}

/** `lsof -Fn` output to the TCP ports a process listens on. */
export function parseLsofPorts(stdout: string): number[] {
  return stdout
    .split("\n")
    .map((line) => /^n.*:(\d+)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
}

async function listCloudflared(): Promise<CloudflaredProcess[]> {
  const { stdout } = await run("ps", ["-axo", "pid=,command="]);
  return parsePs(stdout);
}

/**
 * cloudflared serves `GET /quicktunnel` -> `{"hostname": "..."}` on its metrics
 * port (127.0.0.1:20241-20245 by default). That is how a tunnel started outside
 * the server, by hand or by an old script, is found.
 */
async function quickTunnelUrl(pid: number): Promise<string | null> {
  let ports: number[];
  try {
    const { stdout } = await run("lsof", [
      "-nP",
      "-a",
      "-p",
      String(pid),
      "-iTCP",
      "-sTCP:LISTEN",
      "-Fn",
    ]);
    ports = parseLsofPorts(stdout);
  } catch {
    return null; // lsof exits 1 when the process listens on nothing
  }
  for (const port of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/quicktunnel`, {
        cache: "no-store",
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { hostname?: unknown };
      if (typeof body.hostname === "string" && body.hostname) {
        return `https://${body.hostname}`;
      }
    } catch {
      // Not the metrics port; try the next one.
    }
  }
  return null;
}

async function readState(port: number): Promise<TunnelState | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(statePath(port), "utf8"),
    ) as TunnelState;
    return typeof parsed.url === "string" ? parsed : null;
  } catch {
    return null;
  }
}

async function writeState(state: TunnelState): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(
    statePath(state.port),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

/**
 * Resolve through Cloudflare's public resolver over HTTPS, not the system
 * resolver: macOS caches the NXDOMAIN of a brand-new trycloudflare name for a
 * while, so the system lookup would report a live tunnel as dead.
 */
export async function resolveViaDoh(hostname: string): Promise<string | null> {
  const res = await fetch(
    `https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
    {
      headers: { accept: "application/dns-json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as {
    Answer?: { type: number; data: string }[];
  };
  return body.Answer?.find((a) => a.type === 1)?.data ?? null;
}

const TOOLS_LIST = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
});

/** POST tools/list to `<url>/api/ledgerline/mcp`, connecting to `ip` with the real SNI and Host. */
function postToolsList(
  url: string,
  ip: string,
): Promise<{ status: number; body: string }> {
  const target = new URL(MCP_PATH, url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        host: target.hostname,
        servername: target.hostname,
        path: target.pathname,
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "content-length": Buffer.byteLength(TOOLS_LIST),
        },
        lookup: (_host, options, cb) => {
          if (options.all) cb(null, [{ address: ip, family: 4 }]);
          else
            (cb as unknown as (e: null, a: string, f: number) => void)(
              null,
              ip,
              4,
            );
        },
        timeout: 10_000,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          if (body.length < 4096) body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end(TOOLS_LIST);
  });
}

export async function probe(url: string): Promise<boolean> {
  try {
    const ip = await resolveViaDoh(new URL(url).hostname);
    if (!ip) return false;
    const { status, body } = await postToolsList(url, ip);
    return status === 200 && body.includes('"result"');
  } catch {
    return false;
  }
}

async function kill(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return; // already gone
  }
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // gone between the check and the kill
  }
}

const URL_TIMEOUT_MS = 45_000;

/**
 * Start cloudflared DETACHED, logging to a file, so it outlives this server
 * (a restart of `pnpm start` keeps the same public URL) and does not tie the
 * server's event loop to it.
 */
async function spawnTunnel(
  port: number,
): Promise<{ pid: number; url: string }> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  const logPath = tunnelLogPath(port);
  const fd = openSync(logPath, "w");
  const child = spawn(
    "cloudflared",
    ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`],
    { detached: true, stdio: ["ignore", fd, fd] },
  );
  closeSync(fd);
  const pid = await new Promise<number>((resolve, reject) => {
    child.once("error", (err: NodeJS.ErrnoException) =>
      reject(
        new TunnelError(
          err.code === "ENOENT"
            ? "cloudflared is not installed. Run: brew install cloudflared"
            : `Could not start cloudflared: ${err.message}`,
        ),
      ),
    );
    child.once("spawn", () => resolve(child.pid ?? 0));
  });
  child.unref();

  const deadline = Date.now() + URL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const url = extractTunnelUrl(
      await fs.readFile(logPath, "utf8").catch(() => ""),
    );
    if (url) return { pid, url };
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const tail = (await fs.readFile(logPath, "utf8").catch(() => ""))
    .trim()
    .split("\n")
    .slice(-3)
    .join(" | ");
  await kill(pid);
  throw new TunnelError(
    `cloudflared did not print a tunnel URL within ${URL_TIMEOUT_MS / 1000} seconds. Last log lines: ${tail || "(empty)"}. Log: ${logPath}`,
  );
}

export function nodeTunnelDeps(port: number): TunnelDeps {
  return {
    port,
    listCloudflared,
    quickTunnelUrl,
    readState: () => readState(port),
    writeState,
    probe,
    kill,
    spawnTunnel,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
  };
}
