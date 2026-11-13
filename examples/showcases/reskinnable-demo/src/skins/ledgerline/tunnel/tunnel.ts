/**
 * The public Cloudflare quick tunnel ChatGPT and Claude use to reach `/api/ledgerline/mcp`.
 *
 * A quick tunnel (`cloudflared tunnel --url http://127.0.0.1:<port>`) gets a
 * random `https://<words>.trycloudflare.com` name. When the laptop sleeps,
 * Cloudflare drops it ("Tunnel not found") while the local cloudflared process
 * keeps running, and ChatGPT shows "Could not open this app". The only fix is a
 * new tunnel, which gets a NEW name.
 *
 * `ensureTunnel` keeps a healthy tunnel (same URL) and replaces a dead one.
 * Healthy means the public URL answers a `tools/list` on `/api/ledgerline/mcp` with a JSON-RPC
 * result, which is exactly what ChatGPT needs.
 *
 * Everything with a side effect comes in through `TunnelDeps`, so the decision
 * logic is unit-tested without spawning processes; `node-deps.ts` has the real
 * implementations.
 */

/** Where Ledgerline's MCP server lives on the app's origin. */
export const MCP_PATH = "/api/ledgerline/mcp";

export interface TunnelState {
  url: string;
  port: number;
  pid?: number;
  updatedAt: string;
}

export interface CloudflaredProcess {
  pid: number;
  command: string;
}

export interface TunnelDeps {
  port: number;
  /** Every running cloudflared process (any port). */
  listCloudflared(): Promise<CloudflaredProcess[]>;
  /** The quick-tunnel URL a running cloudflared reports, if it can be read. */
  quickTunnelUrl(pid: number): Promise<string | null>;
  readState(): Promise<TunnelState | null>;
  writeState(state: TunnelState): Promise<void>;
  /** True when `<url>/api/ledgerline/mcp` answers tools/list over the public internet. */
  probe(url: string): Promise<boolean>;
  kill(pid: number): Promise<void>;
  /** Start a detached cloudflared for `port`; resolves once it prints its URL. */
  spawnTunnel(port: number): Promise<{ pid: number; url: string }>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export interface TunnelStatus {
  url: string | null;
  healthy: boolean;
}

export interface EnsureResult {
  url: string;
  changed: boolean;
  healthy: true;
}

const TRYCLOUDFLARE_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/** The first quick-tunnel URL in cloudflared's log output, if any. */
export function extractTunnelUrl(text: string): string | null {
  return TRYCLOUDFLARE_URL.exec(text)?.[0] ?? null;
}

/**
 * Whether a cloudflared command line tunnels to THIS port on the loopback.
 * `(?![0-9])` keeps port 3200 from matching a tunnel to 32001.
 */
export function tunnelsToPort(command: string, port: number): boolean {
  if (!/cloudflared/.test(command) || !/\btunnel\b/.test(command)) return false;
  const re = new RegExp(
    `--url[= ]+https?://(?:127\\.0\\.0\\.1|localhost|\\[::1\\]):${port}(?![0-9])`,
  );
  return re.test(command);
}

async function tunnelPids(deps: TunnelDeps): Promise<number[]> {
  const all = await deps.listCloudflared();
  return all
    .filter((p) => tunnelsToPort(p.command, deps.port))
    .map((p) => p.pid);
}

/**
 * The URL of the tunnel currently serving this port: asked of a running
 * cloudflared first (so one started by hand is found too), then the saved file.
 */
export async function currentTunnelUrl(
  deps: TunnelDeps,
): Promise<string | null> {
  for (const pid of await tunnelPids(deps)) {
    const url = await deps.quickTunnelUrl(pid);
    if (url) return url;
  }
  const saved = await deps.readState();
  return saved && saved.port === deps.port ? saved.url : null;
}

/** One retry, so a single dropped packet does not cost the presenter a new URL. */
async function probeTwice(deps: TunnelDeps, url: string): Promise<boolean> {
  if (await deps.probe(url)) return true;
  await deps.sleep(1500);
  return deps.probe(url);
}

export async function tunnelStatus(deps: TunnelDeps): Promise<TunnelStatus> {
  const url = await currentTunnelUrl(deps);
  return { url, healthy: url ? await deps.probe(url) : false };
}

export class TunnelError extends Error {
  constructor(
    message: string,
    readonly url: string | null = null,
  ) {
    super(message);
    this.name = "TunnelError";
  }
}

/** How long a fresh tunnel gets to start answering before we give up. */
export const HEALTH_TIMEOUT_MS = 90_000;
const HEALTH_POLL_MS = 3_000;

/**
 * Keep the tunnel if it answers; otherwise kill every cloudflared pointing at
 * this port, start a new one, and wait until its public URL answers.
 */
export async function ensureTunnel(deps: TunnelDeps): Promise<EnsureResult> {
  const previous = await currentTunnelUrl(deps);
  const save = (url: string, pid?: number) =>
    deps.writeState({
      url,
      port: deps.port,
      pid,
      updatedAt: new Date(deps.now()).toISOString(),
    });

  if (previous && (await probeTwice(deps, previous))) {
    const pids = await tunnelPids(deps);
    await save(previous, pids[0]);
    return { url: previous, changed: false, healthy: true };
  }

  for (const pid of await tunnelPids(deps)) await deps.kill(pid);

  const { pid, url } = await deps.spawnTunnel(deps.port);
  await save(url, pid);

  const deadline = deps.now() + HEALTH_TIMEOUT_MS;
  while (!(await deps.probe(url))) {
    if (deps.now() >= deadline) {
      throw new TunnelError(
        `A new tunnel started at ${url}, but ${url}${MCP_PATH} did not answer within ${HEALTH_TIMEOUT_MS / 1000} seconds. Press Reset again in a minute.`,
        url,
      );
    }
    await deps.sleep(HEALTH_POLL_MS);
  }
  return { url, changed: url !== previous, healthy: true };
}

/**
 * Serialise concurrent calls (a double-clicked Reset must not start two
 * tunnels): a second caller shares the first caller's in-flight promise.
 */
let inFlight: Promise<EnsureResult> | null = null;
export function ensureTunnelOnce(deps: TunnelDeps): Promise<EnsureResult> {
  inFlight ??= ensureTunnel(deps).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function isLoopbackAddress(value: string): boolean {
  const v = value.trim().toLowerCase();
  return (
    LOOPBACK_HOSTS.has(v) ||
    v === "::ffff:127.0.0.1" ||
    /^127\.\d+\.\d+\.\d+$/.test(v)
  );
}

/**
 * True only for a request made on this machine to the loopback address, never
 * one that came in through the tunnel. cloudflared connects to the server from
 * 127.0.0.1 too, so the socket address proves nothing; what gives a tunnelled
 * request away is Cloudflare's own headers (which a caller cannot strip) and a
 * Host of `<words>.trycloudflare.com`. A cross-site Origin is refused as well,
 * so a web page open in the presenter's browser cannot drive this.
 */
export function isLocalRequest(headers: Headers): boolean {
  for (const h of [
    "cf-connecting-ip",
    "cf-ray",
    "cdn-loop",
    "cf-visitor",
    "cf-ipcountry",
  ]) {
    if (headers.has(h)) return false;
  }
  const host = headers.get("host");
  if (!host || !isLoopbackAddress(hostnameOf(host))) return false;
  const forwardedHost = headers.get("x-forwarded-host");
  if (forwardedHost && !isLoopbackAddress(hostnameOf(forwardedHost)))
    return false;
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor && !forwardedFor.split(",").every(isLoopbackAddress))
    return false;
  const origin = headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).hostname;
    } catch {
      return false;
    }
    if (!isLoopbackAddress(originHost)) return false;
  }
  return true;
}

/** `127.0.0.1:3200` -> `127.0.0.1`, `[::1]:3200` -> `[::1]`. */
function hostnameOf(host: string): string {
  const h = host.trim();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0];
}

/** The server's own port, from the Host of a (loopback) request. */
export function portFromHost(host: string | null, fallback: number): number {
  const m = host ? /:(\d+)$/.exec(host.trim()) : null;
  return m ? Number(m[1]) : fallback;
}
