// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { parseLsofPorts, parsePs } from "./node-deps";
import {
  ensureTunnel,
  ensureTunnelOnce,
  extractTunnelUrl,
  HEALTH_TIMEOUT_MS,
  isLocalRequest,
  portFromHost,
  tunnelsToPort,
  tunnelStatus,
} from "./tunnel";
import type { CloudflaredProcess, TunnelDeps, TunnelState } from "./tunnel";

const OLD = "https://old-words-here.trycloudflare.com";
const NEW = "https://new-words-here.trycloudflare.com";

/** In-memory deps: `healthy` is the set of URLs that answer, `procs` the running cloudflareds. */
function fakeDeps(opts: {
  port?: number;
  procs?: CloudflaredProcess[];
  metrics?: Record<number, string>;
  state?: TunnelState | null;
  healthy?: Set<string>;
  spawnUrl?: string;
  healthyAfterProbes?: number;
}) {
  let clock = 0;
  let procs = [...(opts.procs ?? [])];
  let state = opts.state ?? null;
  const healthy = opts.healthy ?? new Set<string>();
  const probes: string[] = [];
  const deps: TunnelDeps = {
    port: opts.port ?? 3201,
    listCloudflared: async () => procs,
    quickTunnelUrl: async (pid) => opts.metrics?.[pid] ?? null,
    readState: async () => state,
    writeState: async (s) => {
      state = s;
    },
    probe: async (url) => {
      probes.push(url);
      if (
        opts.healthyAfterProbes !== undefined &&
        url === opts.spawnUrl &&
        probes.filter((p) => p === url).length >= opts.healthyAfterProbes
      ) {
        return true;
      }
      return healthy.has(url);
    },
    kill: vi.fn(async (pid: number) => {
      procs = procs.filter((p) => p.pid !== pid);
    }),
    spawnTunnel: vi.fn(async (port: number) => {
      const pid = 999;
      procs.push({
        pid,
        command: `cloudflared tunnel --url http://127.0.0.1:${port}`,
      });
      return { pid, url: opts.spawnUrl ?? NEW };
    }),
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, probes, getState: () => state };
}

const proc = (pid: number, port: number): CloudflaredProcess => ({
  pid,
  command: `cloudflared tunnel --url http://127.0.0.1:${port}`,
});

describe("tunnelsToPort", () => {
  it("matches only a tunnel to this port", () => {
    expect(
      tunnelsToPort("cloudflared tunnel --url http://127.0.0.1:3200", 3200),
    ).toBe(true);
    expect(
      tunnelsToPort(
        "/opt/homebrew/bin/cloudflared tunnel --no-autoupdate --url http://localhost:3200",
        3200,
      ),
    ).toBe(true);
    expect(
      tunnelsToPort("cloudflared tunnel --url http://127.0.0.1:3200", 3201),
    ).toBe(false);
    expect(
      tunnelsToPort("cloudflared tunnel --url http://127.0.0.1:32001", 3200),
    ).toBe(false);
    expect(
      tunnelsToPort("node server.js --url http://127.0.0.1:3200", 3200),
    ).toBe(false);
  });
});

describe("extractTunnelUrl", () => {
  it("finds the quick-tunnel URL in cloudflared's banner", () => {
    const log = `2026-09-28T08:33:37Z INF |  ${NEW}                     |`;
    expect(extractTunnelUrl(log)).toBe(NEW);
    expect(
      extractTunnelUrl(
        "INF Requesting new quick Tunnel on trycloudflare.com...",
      ),
    ).toBeNull();
  });
});

describe("ensureTunnel", () => {
  it("keeps a healthy tunnel found through cloudflared's metrics (same URL, no change)", async () => {
    const other = proc(10, 3200);
    const { deps, getState } = fakeDeps({
      procs: [other, proc(11, 3201)],
      metrics: { 10: "https://not-mine.trycloudflare.com", 11: OLD },
      healthy: new Set([OLD]),
    });
    await expect(ensureTunnel(deps)).resolves.toEqual({
      url: OLD,
      changed: false,
      healthy: true,
    });
    expect(deps.kill).not.toHaveBeenCalled();
    expect(deps.spawnTunnel).not.toHaveBeenCalled();
    expect(getState()).toMatchObject({ url: OLD, port: 3201, pid: 11 });
  });

  it("replaces a dead tunnel: kills only this port's cloudflared, reports the new URL as changed", async () => {
    const { deps, getState } = fakeDeps({
      procs: [proc(10, 3200), proc(11, 3201)],
      metrics: { 11: OLD },
      healthy: new Set([NEW]),
    });
    await expect(ensureTunnel(deps)).resolves.toEqual({
      url: NEW,
      changed: true,
      healthy: true,
    });
    expect(deps.kill).toHaveBeenCalledTimes(1);
    expect(deps.kill).toHaveBeenCalledWith(11);
    expect(deps.spawnTunnel).toHaveBeenCalledWith(3201);
    expect(getState()).toMatchObject({ url: NEW, port: 3201, pid: 999 });
  });

  it("retries a failed probe once before giving up on the URL", async () => {
    let calls = 0;
    const { deps } = fakeDeps({
      procs: [proc(11, 3201)],
      metrics: { 11: OLD },
    });
    deps.probe = async () => ++calls > 1;
    await expect(ensureTunnel(deps)).resolves.toMatchObject({
      url: OLD,
      changed: false,
    });
    expect(deps.spawnTunnel).not.toHaveBeenCalled();
  });

  it("falls back to the saved URL when no cloudflared is running", async () => {
    const { deps } = fakeDeps({
      state: { url: OLD, port: 3201, updatedAt: "" },
      healthy: new Set([NEW]),
    });
    await expect(ensureTunnel(deps)).resolves.toEqual({
      url: NEW,
      changed: true,
      healthy: true,
    });
    expect(deps.kill).not.toHaveBeenCalled();
  });

  it("ignores a saved URL that belongs to another port", async () => {
    const { deps } = fakeDeps({
      state: { url: OLD, port: 3200, updatedAt: "" },
      healthy: new Set([OLD, NEW]),
    });
    await expect(ensureTunnel(deps)).resolves.toMatchObject({
      url: NEW,
      changed: true,
    });
  });

  it("waits for a fresh tunnel to answer", async () => {
    const { deps } = fakeDeps({ spawnUrl: NEW, healthyAfterProbes: 4 });
    await expect(ensureTunnel(deps)).resolves.toMatchObject({
      url: NEW,
      changed: true,
    });
  });

  it("fails plainly when the fresh tunnel never answers", async () => {
    const { deps } = fakeDeps({});
    await expect(ensureTunnel(deps)).rejects.toThrow(
      `did not answer within ${HEALTH_TIMEOUT_MS / 1000} seconds`,
    );
  });

  it("shares one in-flight run between concurrent callers", async () => {
    const { deps } = fakeDeps({ healthy: new Set([NEW]) });
    const [a, b] = await Promise.all([
      ensureTunnelOnce(deps),
      ensureTunnelOnce(deps),
    ]);
    expect(a).toEqual(b);
    expect(deps.spawnTunnel).toHaveBeenCalledTimes(1);
  });
});

describe("tunnelStatus", () => {
  it("reports the current URL and whether it answers", async () => {
    const { deps } = fakeDeps({
      procs: [proc(11, 3201)],
      metrics: { 11: OLD },
    });
    await expect(tunnelStatus(deps)).resolves.toEqual({
      url: OLD,
      healthy: false,
    });
    const none = fakeDeps({});
    await expect(tunnelStatus(none.deps)).resolves.toEqual({
      url: null,
      healthy: false,
    });
  });
});

describe("isLocalRequest", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it("allows a request to the loopback from this machine", () => {
    expect(isLocalRequest(h({ host: "127.0.0.1:3200" }))).toBe(true);
    expect(
      isLocalRequest(
        h({ host: "localhost:3200", origin: "http://localhost:3200" }),
      ),
    ).toBe(true);
    expect(
      isLocalRequest(h({ host: "[::1]:3200", "x-forwarded-for": "::1" })),
    ).toBe(true);
    expect(
      isLocalRequest(
        h({ host: "127.0.0.1:3200", "x-forwarded-for": "::ffff:127.0.0.1" }),
      ),
    ).toBe(true);
  });
  it("refuses anything that came through the tunnel", () => {
    expect(
      isLocalRequest(h({ host: "old-words-here.trycloudflare.com" })),
    ).toBe(false);
    // Even with a spoofed Host, Cloudflare's own headers give it away.
    expect(
      isLocalRequest(
        h({ host: "127.0.0.1:3200", "cf-connecting-ip": "203.0.113.9" }),
      ),
    ).toBe(false);
    expect(isLocalRequest(h({ host: "127.0.0.1:3200", "cf-ray": "abc" }))).toBe(
      false,
    );
    expect(
      isLocalRequest(
        h({
          host: "127.0.0.1:3200",
          "x-forwarded-for": "203.0.113.9, 127.0.0.1",
        }),
      ),
    ).toBe(false);
    expect(
      isLocalRequest(
        h({
          host: "127.0.0.1:3200",
          "x-forwarded-host": "x.trycloudflare.com",
        }),
      ),
    ).toBe(false);
  });
  it("refuses a cross-site page in the presenter's browser, and a missing Host", () => {
    expect(
      isLocalRequest(
        h({ host: "127.0.0.1:3200", origin: "https://evil.example" }),
      ),
    ).toBe(false);
    expect(isLocalRequest(h({}))).toBe(false);
  });
});

describe("portFromHost", () => {
  it("reads the port from the Host header", () => {
    expect(portFromHost("127.0.0.1:3201", 3000)).toBe(3201);
    expect(portFromHost("[::1]:3200", 3000)).toBe(3200);
    expect(portFromHost("localhost", 3000)).toBe(3000);
    expect(portFromHost(null, 3000)).toBe(3000);
  });
});

describe("process parsing", () => {
  it("parses ps output down to cloudflared processes", () => {
    const out = [
      "  91191 cloudflared tunnel --url http://127.0.0.1:3200",
      "  27484 next-server (v16.3.1)",
      "    12 /opt/homebrew/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3201",
      "    13 grep cloudflared",
    ].join("\n");
    expect(parsePs(out).map((p) => p.pid)).toEqual([91191, 12]);
  });
  it("parses lsof -Fn listen ports", () => {
    expect(parseLsofPorts("p91191\nf10\nn127.0.0.1:20242\n")).toEqual([20242]);
    expect(parseLsofPorts("")).toEqual([]);
  });
});
