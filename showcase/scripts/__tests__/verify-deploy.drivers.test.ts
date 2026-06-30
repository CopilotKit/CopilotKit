/**
 * Red-green tests for the baseline `verify-deploy` driver impls.
 *
 * Drivers were originally stubs that returned `{ ok: false, error: "...
 * not yet implemented ..." }`. These tests pin the agreed completion
 * bar: every driver performs the two baseline checks (Railway
 * deployment-SUCCESS via GraphQL + healthcheck HTTP 200) before any
 * driver-specific extension runs.
 *
 * Network seams (`fetchImpl`, `getRailwayToken`) are injected so the
 * suite runs fully offline. These are NOT LLM calls — plain vi-fn stubs
 * are appropriate; aimock is not used here.
 */
import { describe, expect, it, vi } from "vitest";
import { SERVICES, domainFor } from "../railway-envs";
import type { ProbeTarget } from "../verify-deploy";
// Tests construct `ProbeTarget.host` via `asHost(...)` to satisfy the
// `Host` brand — the same validator the runtime ingress uses.
import { asHost } from "../verify-deploy";
import fs from "fs";
import os from "os";
import path from "path";
import {
  checkDeploymentSuccess,
  checkHealthcheck200,
  defaultGetRailwayToken,
  envForTarget,
  probeBaseline,
} from "../verify-deploy.drivers.baseline";
import type { FetchLike } from "../verify-deploy.drivers.baseline";
import { probeShell } from "../verify-deploy.drivers.shell";
import { probeDocs } from "../verify-deploy.drivers.docs";
import { probeDashboard } from "../verify-deploy.drivers.dashboard";
import { probeDojo } from "../verify-deploy.drivers.dojo";
import { probeHarness } from "../verify-deploy.drivers.harness";
import { probeEval } from "../verify-deploy.drivers.eval";
import { probeAimock } from "../verify-deploy.drivers.aimock";
import { probePocketbase } from "../verify-deploy.drivers.pocketbase";
import { probeWebhooks } from "../verify-deploy.drivers.webhooks";
import { probeAgent } from "../verify-deploy.drivers.agent";
import { probeStarter } from "../verify-deploy.drivers.starter";
import { runDriver } from "../verify-deploy.drivers";

const TOKEN = "tok_test_abcdef";

function mkResponse(body: {
  status?: number;
  json?: unknown;
  text?: string;
  ok?: boolean;
}): Awaited<ReturnType<FetchLike>> {
  const status = body.status ?? 200;
  return {
    ok: body.ok ?? (status >= 200 && status < 300),
    status,
    async text() {
      return body.text ?? JSON.stringify(body.json ?? {});
    },
    async json() {
      return body.json ?? {};
    },
  };
}

function makeFetch(
  handler: (
    url: string,
    init?: Parameters<FetchLike>[1],
  ) => ReturnType<FetchLike>,
): FetchLike {
  return vi.fn(handler);
}

function gqlDeploymentResponse(status: string): ReturnType<FetchLike> {
  return Promise.resolve(
    mkResponse({
      json: {
        data: {
          deployments: {
            edges: [{ node: { id: "d1", status } }],
          },
        },
      },
    }),
  );
}

describe("defaultGetRailwayToken non-ENOENT errors are NOT swallowed", () => {
  it("surfaces a clear diagnostic on non-ENOENT read errors (e.g. EISDIR via directory at config path)", () => {
    // Point HOME at a tmpdir where ~/.railway/config.json is itself a
    // directory — fs.readFileSync raises EISDIR. The previous bare
    // `catch {}` swallowed it; the fix must NOT silently return
    // undefined without a diagnostic on stderr identifying the path.
    const tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "verify-deploy-token-"),
    );
    const railwayDir = path.join(tmpHome, ".railway");
    fs.mkdirSync(railwayDir, { recursive: true });
    // Make config.json a directory (not a file).
    fs.mkdirSync(path.join(railwayDir, "config.json"));

    const origHome = process.env.HOME;
    const origToken = process.env.RAILWAY_TOKEN;
    delete process.env.RAILWAY_TOKEN;
    process.env.HOME = tmpHome;

    const stderr: string[] = [];
    const realWrite = process.stderr.write.bind(process.stderr);
    (
      process.stderr as unknown as { write: typeof process.stderr.write }
    ).write = ((chunk: string | Uint8Array): boolean => {
      stderr.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
      );
      return true;
    }) as typeof process.stderr.write;
    try {
      const out = defaultGetRailwayToken();
      expect(out).toBeUndefined();
      const joined = stderr.join("");
      // The fix must log a diagnostic identifying the config path
      // and the error — bare `catch {}` printed nothing.
      expect(joined).toMatch(/config\.json/);
      expect(joined).toMatch(/EISDIR|directory|read/i);
    } finally {
      (
        process.stderr as unknown as { write: typeof process.stderr.write }
      ).write = realWrite;
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
      if (origToken === undefined) delete process.env.RAILWAY_TOKEN;
      else process.env.RAILWAY_TOKEN = origToken;
      try {
        fs.rmSync(tmpHome, { recursive: true, force: true });
      } catch {
        /* cleanup */
      }
    }
  });

  it("treats ENOENT (missing config file) as the legitimate no-token path (silent undefined)", () => {
    const tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "verify-deploy-token-"),
    );
    const origHome = process.env.HOME;
    const origToken = process.env.RAILWAY_TOKEN;
    delete process.env.RAILWAY_TOKEN;
    process.env.HOME = tmpHome;

    const stderr: string[] = [];
    const realWrite = process.stderr.write.bind(process.stderr);
    (
      process.stderr as unknown as { write: typeof process.stderr.write }
    ).write = ((chunk: string | Uint8Array): boolean => {
      stderr.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
      );
      return true;
    }) as typeof process.stderr.write;
    try {
      const out = defaultGetRailwayToken();
      expect(out).toBeUndefined();
      // ENOENT is the legitimate no-token path — no diagnostic spam.
      expect(stderr.join("")).toBe("");
    } finally {
      (
        process.stderr as unknown as { write: typeof process.stderr.write }
      ).write = realWrite;
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
      if (origToken === undefined) delete process.env.RAILWAY_TOKEN;
      else process.env.RAILWAY_TOKEN = origToken;
      try {
        fs.rmSync(tmpHome, { recursive: true, force: true });
      } catch {
        /* cleanup */
      }
    }
  });
});

describe("envForTarget", () => {
  it("returns 'staging' when host matches the SSOT staging domain", () => {
    const t: ProbeTarget = {
      name: "docs",
      host: asHost(domainFor("docs", "staging")),
      driver: "docs",
    };
    expect(envForTarget(t)).toBe("staging");
  });

  it("returns 'prod' when host matches the SSOT prod domain", () => {
    const t: ProbeTarget = {
      name: "docs",
      host: asHost(domainFor("docs", "prod")),
      driver: "docs",
    };
    expect(envForTarget(t)).toBe("prod");
  });

  it("returns undefined for unknown host or unknown service", () => {
    expect(
      envForTarget({
        name: "docs",
        host: asHost("bogus.example"),
        driver: "docs",
      }),
    ).toBeUndefined();
    expect(
      envForTarget({ name: "nonsuch", host: asHost("x"), driver: "docs" }),
    ).toBeUndefined();
  });
});

describe("checkDeploymentSuccess", () => {
  it("returns undefined when Railway reports SUCCESS", async () => {
    const fetchImpl = makeFetch(() => gqlDeploymentResponse("SUCCESS"));
    const err = await checkDeploymentSuccess(
      "svc-id",
      "staging",
      TOKEN,
      fetchImpl,
      5000,
      "shell",
    );
    expect(err).toBeUndefined();
  });

  it("returns an error string when status is not SUCCESS", async () => {
    const fetchImpl = makeFetch(() => gqlDeploymentResponse("CRASHED"));
    const err = await checkDeploymentSuccess(
      "svc-id",
      "prod",
      TOKEN,
      fetchImpl,
      5000,
      "shell",
    );
    expect(err).toMatch(/CRASHED/);
    expect(err).toMatch(/prod/);
  });

  it("returns an error when GraphQL returns errors[]", async () => {
    const fetchImpl = makeFetch(() =>
      Promise.resolve(
        mkResponse({ json: { errors: [{ message: "bad token" }] } }),
      ),
    );
    const err = await checkDeploymentSuccess(
      "svc-id",
      "staging",
      TOKEN,
      fetchImpl,
      5000,
      "shell",
    );
    expect(err).toMatch(/bad token/);
  });

  it("returns an error on HTTP non-2xx", async () => {
    const fetchImpl = makeFetch(() =>
      Promise.resolve(mkResponse({ status: 401, text: "unauthorized" })),
    );
    const err = await checkDeploymentSuccess(
      "svc-id",
      "staging",
      TOKEN,
      fetchImpl,
      5000,
      "shell",
    );
    expect(err).toMatch(/401/);
  });

  it("returns an error when no deployment edge exists", async () => {
    const fetchImpl = makeFetch(() =>
      Promise.resolve(
        mkResponse({ json: { data: { deployments: { edges: [] } } } }),
      ),
    );
    const err = await checkDeploymentSuccess(
      "svc-id",
      "staging",
      TOKEN,
      fetchImpl,
      5000,
      "shell",
    );
    expect(err).toMatch(/no deployments/);
  });

  it("waits out an in-progress deployment, then passes on SUCCESS", async () => {
    // DEPLOYING twice, then SUCCESS — the exact race verify-prod hit
    // (promote pins digest, Railway still rolling out). Must NOT fail on
    // the first in-progress read.
    const statuses = ["DEPLOYING", "DEPLOYING", "SUCCESS"];
    let i = 0;
    const fetchImpl = makeFetch(() =>
      gqlDeploymentResponse(statuses[Math.min(i++, statuses.length - 1)]),
    );
    const sleeps: number[] = [];
    const err = await checkDeploymentSuccess(
      "svc-id",
      "prod",
      TOKEN,
      fetchImpl,
      5000,
      "docs",
      "docs",
      {
        pollTimeoutMs: 150_000,
        pollIntervalMs: 5_000,
        // Deterministic, instant sleep seam — record the requested delays.
        sleep: async (ms: number) => {
          sleeps.push(ms);
        },
      },
    );
    expect(err).toBeUndefined();
    // Polled twice (two in-progress reads) before the SUCCESS read.
    expect(sleeps).toEqual([5_000, 5_000]);
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });

  it("fails when an in-progress deployment never settles before the poll budget", async () => {
    // Always DEPLOYING. A monotonic `now` seam advances past the budget
    // so the loop terminates deterministically with a timeout error.
    const fetchImpl = makeFetch(() => gqlDeploymentResponse("DEPLOYING"));
    let clock = 0;
    const err = await checkDeploymentSuccess(
      "svc-id",
      "prod",
      TOKEN,
      fetchImpl,
      5000,
      "docs",
      "docs",
      {
        pollTimeoutMs: 20_000,
        pollIntervalMs: 5_000,
        sleep: async (ms: number) => {
          clock += ms;
        },
        now: () => clock,
      },
    );
    expect(err).toMatch(/still in progress/);
    expect(err).toMatch(/DEPLOYING/);
    expect(err).toMatch(/prod/);
  });

  it("fails FAST on a terminal FAILED status without waiting", async () => {
    const fetchImpl = makeFetch(() => gqlDeploymentResponse("FAILED"));
    const sleeps: number[] = [];
    const err = await checkDeploymentSuccess(
      "svc-id",
      "prod",
      TOKEN,
      fetchImpl,
      5000,
      "docs",
      "docs",
      {
        pollTimeoutMs: 150_000,
        pollIntervalMs: 5_000,
        sleep: async (ms: number) => {
          sleeps.push(ms);
        },
      },
    );
    expect(err).toMatch(/FAILED/);
    expect(err).toMatch(/expected SUCCESS/);
    // No waiting on a terminal failure — exactly one query, zero sleeps.
    expect(sleeps).toEqual([]);
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("sends the Authorization bearer + serviceId/environmentId variables", async () => {
    const calls: Array<{ url: string; body: unknown; auth?: string }> = [];
    const fetchImpl = makeFetch((url, init) => {
      calls.push({
        url,
        body: JSON.parse(String(init?.body ?? "{}")),
        auth: init?.headers?.Authorization,
      });
      return gqlDeploymentResponse("SUCCESS");
    });
    await checkDeploymentSuccess(
      "svc-123",
      "staging",
      TOKEN,
      fetchImpl,
      5000,
      "shell",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/backboard\.railway\.app\/graphql\/v2/);
    expect(calls[0].auth).toBe(`Bearer ${TOKEN}`);
    const body = calls[0].body as {
      query: string;
      variables: { serviceId: string; environmentId: string };
    };
    expect(body.query).toMatch(/deployments\(first: 1/);
    expect(body.variables.serviceId).toBe("svc-123");
    expect(body.variables.environmentId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("checkHealthcheck200", () => {
  it("returns undefined on HTTP 200", async () => {
    const fetchImpl = makeFetch(() =>
      Promise.resolve(mkResponse({ status: 200 })),
    );
    const err = await checkHealthcheck200(
      "docs.example",
      "/",
      fetchImpl,
      5000,
      "docs",
    );
    expect(err).toBeUndefined();
  });

  it("returns an error string on non-200", async () => {
    const fetchImpl = makeFetch(() =>
      Promise.resolve(mkResponse({ status: 503 })),
    );
    const err = await checkHealthcheck200(
      "docs.example",
      "/",
      fetchImpl,
      5000,
      "docs",
    );
    expect(err).toMatch(/503/);
    expect(err).toMatch(/docs/);
  });

  it("composes https + host + path correctly", async () => {
    const calls: string[] = [];
    const fetchImpl = makeFetch((url) => {
      calls.push(url);
      return Promise.resolve(mkResponse({ status: 200 }));
    });
    await checkHealthcheck200(
      "showcase-aimock-production.up.railway.app",
      "/health",
      fetchImpl,
      5000,
      "aimock",
    );
    expect(calls[0]).toBe(
      "https://showcase-aimock-production.up.railway.app/health",
    );
  });

  it("returns an error on fetch throw", async () => {
    const fetchImpl = makeFetch(() =>
      Promise.reject(new Error("ECONNREFUSED")),
    );
    const err = await checkHealthcheck200(
      "docs.example",
      "/",
      fetchImpl,
      5000,
      "docs",
    );
    expect(err).toMatch(/ECONNREFUSED/);
  });
});

describe("probeBaseline", () => {
  function okFetch(): FetchLike {
    return makeFetch((url) => {
      if (url.includes("/graphql/v2")) return gqlDeploymentResponse("SUCCESS");
      return Promise.resolve(mkResponse({ status: 200 }));
    });
  }

  it("returns ok when GraphQL = SUCCESS and healthcheck = 200", async () => {
    const out = await probeBaseline(
      {
        name: "docs",
        host: asHost(domainFor("docs", "staging")),
        driver: "docs",
      },
      {
        driverLabel: "docs",
        healthcheckPath: "/",
        fetchImpl: okFetch(),
        getRailwayToken: () => TOKEN,
      },
    );
    expect(out).toEqual({ ok: true });
  });

  it("fails loud when env cannot be resolved from host", async () => {
    const out = await probeBaseline(
      { name: "docs", host: asHost("wrong.example"), driver: "docs" },
      {
        driverLabel: "docs",
        healthcheckPath: "/",
        fetchImpl: okFetch(),
        getRailwayToken: () => TOKEN,
      },
    );
    expect(out.ok).toBe(false);
    if (out.ok === false) {
      expect(out.error).toMatch(/cannot resolve env/);
    }
  });

  it("fails loud when no Railway token is available", async () => {
    const out = await probeBaseline(
      {
        name: "docs",
        host: asHost(domainFor("docs", "staging")),
        driver: "docs",
      },
      {
        driverLabel: "docs",
        healthcheckPath: "/",
        fetchImpl: okFetch(),
        getRailwayToken: () => undefined,
      },
    );
    expect(out.ok).toBe(false);
    if (out.ok === false) {
      expect(out.error).toMatch(/no Railway token/);
    }
  });

  it("fails on deployment status != SUCCESS", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.includes("/graphql/v2")) return gqlDeploymentResponse("CRASHED");
      return Promise.resolve(mkResponse({ status: 200 }));
    });
    const out = await probeBaseline(
      {
        name: "docs",
        host: asHost(domainFor("docs", "staging")),
        driver: "docs",
      },
      {
        driverLabel: "docs",
        healthcheckPath: "/",
        fetchImpl,
        getRailwayToken: () => TOKEN,
      },
    );
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.error).toMatch(/CRASHED/);
  });

  it("fails on healthcheck != 200", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.includes("/graphql/v2")) return gqlDeploymentResponse("SUCCESS");
      return Promise.resolve(mkResponse({ status: 502 }));
    });
    const out = await probeBaseline(
      {
        name: "docs",
        host: asHost(domainFor("docs", "staging")),
        driver: "docs",
      },
      {
        driverLabel: "docs",
        healthcheckPath: "/",
        fetchImpl,
        getRailwayToken: () => TOKEN,
      },
    );
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.error).toMatch(/502/);
  });
});

/**
 * Per-driver tests. Each driver exports a probeX(target) that takes ONLY
 * the target; the test seam is via `globalThis.fetch` + `RAILWAY_TOKEN`
 * env var. We stub both for the duration of each test.
 *
 * What we pin per driver:
 *   - It is no longer a "not yet implemented" stub.
 *   - It calls Railway GraphQL with the SSOT serviceId for the matched
 *     env, expecting `SUCCESS`.
 *   - It hits the healthcheck URL appropriate to its service shape.
 *   - It returns `{ok:true}` on a green baseline, `{ok:false}` on red.
 */
function withGlobalSeam(
  fetchImpl: FetchLike,
  token: string | undefined,
  fn: () => Promise<void>,
): Promise<void> {
  const realFetch = globalThis.fetch;
  const realToken = process.env.RAILWAY_TOKEN;
  (globalThis as unknown as { fetch: FetchLike }).fetch = fetchImpl;
  if (token === undefined) delete process.env.RAILWAY_TOKEN;
  else process.env.RAILWAY_TOKEN = token;
  return fn().finally(() => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = realFetch;
    if (realToken === undefined) delete process.env.RAILWAY_TOKEN;
    else process.env.RAILWAY_TOKEN = realToken;
  });
}

type DriverFn = (
  target: ProbeTarget,
) => Promise<{ ok: true } | { ok: false; error: string }>;

interface DriverCase {
  label: string;
  driver: DriverFn;
  service: keyof typeof SERVICES;
  enumLiteral: string;
  expectedHealthPath: string;
}

const DRIVER_CASES: DriverCase[] = [
  {
    label: "shell",
    driver: probeShell,
    service: "shell",
    enumLiteral: "shell",
    expectedHealthPath: "/",
  },
  {
    label: "docs",
    driver: probeDocs,
    service: "docs",
    enumLiteral: "docs",
    expectedHealthPath: "/",
  },
  {
    label: "dashboard",
    driver: probeDashboard,
    service: "dashboard",
    enumLiteral: "dashboard",
    expectedHealthPath: "/",
  },
  {
    label: "dojo",
    driver: probeDojo,
    service: "dojo",
    enumLiteral: "dojo",
    expectedHealthPath: "/",
  },
  {
    label: "harness",
    driver: probeHarness,
    service: "harness",
    enumLiteral: "harness",
    expectedHealthPath: "/health",
  },
  {
    label: "aimock",
    driver: probeAimock,
    service: "aimock",
    enumLiteral: "aimock",
    expectedHealthPath: "/health",
  },
  {
    label: "pocketbase",
    driver: probePocketbase,
    service: "pocketbase",
    enumLiteral: "pocketbase",
    expectedHealthPath: "/api/health",
  },
  {
    label: "webhooks",
    driver: probeWebhooks,
    service: "webhooks",
    enumLiteral: "webhooks",
    expectedHealthPath: "/api/health",
  },
  {
    // No service in the SSOT currently uses the `eval` driver literal,
    // but the enum literal exists in railway-envs.ts and the dispatch
    // switch wires probeEval. We still need probeEval to be a working
    // impl. Test it by routing through any real SSOT service —
    // probeEval's behavior is structurally identical to the agent
    // driver; we use `harness` as the host carrier since it's the
    // smallest standalone API surface in the SSOT.
    label: "eval",
    driver: probeEval,
    service: "harness",
    enumLiteral: "eval",
    expectedHealthPath: "/api/health",
  },
  {
    label: "agent",
    driver: probeAgent,
    service: "showcase-mastra",
    enumLiteral: "agent",
    expectedHealthPath: "/api/health",
  },
  {
    // The starter-template container fleet (`starter-<slug>`). Starters
    // EXPOSE only the Next.js frontend (port 3000) which serves `/` and
    // `/api/copilotkit` but NO `/api/health` — so the baseline driver
    // healthchecks `/`, exactly like the Next.js shells.
    label: "starter",
    driver: probeStarter,
    service: "starter-adk",
    enumLiteral: "starter",
    expectedHealthPath: "/",
  },
];

describe.each(DRIVER_CASES)(
  "$label driver",
  ({ label, driver, service, expectedHealthPath }) => {
    it("is no longer a 'not yet implemented' stub", async () => {
      // GREEN baseline against the live seam.
      const entry = SERVICES[service];
      if (!entry) {
        throw new Error(
          `test setup: SERVICES["${service}"] is missing — update DRIVER_CASES`,
        );
      }
      const fetchImpl = makeFetch((url) => {
        if (url.includes("/graphql/v2"))
          return gqlDeploymentResponse("SUCCESS");
        return Promise.resolve(mkResponse({ status: 200 }));
      });
      await withGlobalSeam(fetchImpl, TOKEN, async () => {
        const out = await driver({
          name: service,
          host: asHost(domainFor(service, "staging")),
          driver: label as ProbeTarget["driver"],
        });
        expect(out.ok).toBe(true);
        if (out.ok === false) {
          // Specifically reject the legacy stub message — that
          // was the bug we're fixing.
          expect(out.error).not.toMatch(/not yet implemented/);
        }
      });
    });

    it("hits the expected healthcheck path", async () => {
      const entry = SERVICES[service];
      if (!entry) throw new Error("test setup");
      const seen: string[] = [];
      const fetchImpl = makeFetch((url) => {
        seen.push(url);
        if (url.includes("/graphql/v2"))
          return gqlDeploymentResponse("SUCCESS");
        return Promise.resolve(mkResponse({ status: 200 }));
      });
      await withGlobalSeam(fetchImpl, TOKEN, async () => {
        await driver({
          name: service,
          host: asHost(domainFor(service, "prod")),
          driver: label as ProbeTarget["driver"],
        });
      });
      const healthUrls = seen.filter((u) => !u.includes("/graphql/v2"));
      // The dashboard driver makes a SECOND GET to `/` after the baseline
      // healthcheck to fetch + sentinel-check the injected
      // `__SHOWCASE_CONFIG__` (see verify-deploy.drivers.dashboard.ts). That
      // extra GET targets the same `/` path, so both non-graphql fetches go
      // to `https://<host>/`. Every other driver makes exactly one.
      const expectedHealthCount = label === "dashboard" ? 2 : 1;
      expect(healthUrls).toHaveLength(expectedHealthCount);
      for (const u of healthUrls) {
        expect(u).toBe(
          `https://${domainFor(service, "prod")}${expectedHealthPath}`,
        );
      }
    });

    it("queries Railway with the SSOT serviceId for the resolved env", async () => {
      const entry = SERVICES[service];
      if (!entry) throw new Error("test setup");
      let gqlBody: { variables?: { serviceId?: string } } | undefined;
      const fetchImpl = makeFetch((url, init) => {
        if (url.includes("/graphql/v2")) {
          gqlBody = JSON.parse(String(init?.body ?? "{}"));
          return gqlDeploymentResponse("SUCCESS");
        }
        return Promise.resolve(mkResponse({ status: 200 }));
      });
      await withGlobalSeam(fetchImpl, TOKEN, async () => {
        await driver({
          name: service,
          host: asHost(domainFor(service, "staging")),
          driver: label as ProbeTarget["driver"],
        });
      });
      expect(gqlBody?.variables?.serviceId).toBe(entry.serviceId);
    });

    it("fails on CRASHED deployment status", async () => {
      const entry = SERVICES[service];
      if (!entry) throw new Error("test setup");
      const fetchImpl = makeFetch((url) => {
        if (url.includes("/graphql/v2"))
          return gqlDeploymentResponse("CRASHED");
        return Promise.resolve(mkResponse({ status: 200 }));
      });
      await withGlobalSeam(fetchImpl, TOKEN, async () => {
        const out = await driver({
          name: service,
          host: asHost(domainFor(service, "staging")),
          driver: label as ProbeTarget["driver"],
        });
        expect(out.ok).toBe(false);
        if (out.ok === false) expect(out.error).toMatch(/CRASHED/);
      });
    });

    it("fails on healthcheck != 200", async () => {
      const entry = SERVICES[service];
      if (!entry) throw new Error("test setup");
      const fetchImpl = makeFetch((url) => {
        if (url.includes("/graphql/v2"))
          return gqlDeploymentResponse("SUCCESS");
        return Promise.resolve(mkResponse({ status: 502 }));
      });
      await withGlobalSeam(fetchImpl, TOKEN, async () => {
        const out = await driver({
          name: service,
          host: asHost(domainFor(service, "staging")),
          driver: label as ProbeTarget["driver"],
        });
        expect(out.ok).toBe(false);
        if (out.ok === false) expect(out.error).toMatch(/502/);
      });
    });
  },
);

describe("runDriver dispatch: starter is a real baseline driver, not a fail-loud stub", () => {
  it("routes a driver:'starter' target through the baseline probe (ok on a healthy starter)", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.includes("/graphql/v2")) return gqlDeploymentResponse("SUCCESS");
      return Promise.resolve(mkResponse({ status: 200 }));
    });
    await withGlobalSeam(fetchImpl, TOKEN, async () => {
      const out = await runDriver({
        name: "starter-adk",
        host: asHost(domainFor("starter-adk", "staging")),
        driver: "starter",
      });
      expect(out.ok).toBe(true);
      if (out.ok === false) {
        // The legacy stub returned this exact phrasing — assert it's gone.
        expect(out.error).not.toMatch(/is not handled by verify-deploy/);
      }
    });
  });

  it("still fails for a genuinely-down starter (CRASHED deployment)", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.includes("/graphql/v2")) return gqlDeploymentResponse("CRASHED");
      return Promise.resolve(mkResponse({ status: 200 }));
    });
    await withGlobalSeam(fetchImpl, TOKEN, async () => {
      const out = await runDriver({
        name: "starter-adk",
        host: asHost(domainFor("starter-adk", "staging")),
        driver: "starter",
      });
      expect(out.ok).toBe(false);
      if (out.ok === false) expect(out.error).toMatch(/CRASHED/);
    });
  });
});

describe("probeDashboard runtime-config sentinel guard", () => {
  // Build the dashboard `/` HTML carrying the root-layout injection
  // `<script id="__showcase_config__">window.__SHOWCASE_CONFIG__={...};</script>`.
  // The serializer escapes `<` to <; our config URLs never contain `<`,
  // so the JSON is byte-identical to JSON.stringify.
  function dashboardHtml(cfg: Record<string, unknown>): string {
    const json = JSON.stringify(cfg);
    return `<!doctype html><html><head><script id="__showcase_config__">window.__SHOWCASE_CONFIG__=${json};</script></head><body>ok</body></html>`;
  }

  const PROD_INVALID_SHELL_URL = "about:blank#shell-url-missing";
  const PROD_INVALID_POCKETBASE_URL = "http://pocketbase.invalid";
  const HEALTHY_CFG = {
    pocketbaseUrl: "https://pb.example.com",
    shellUrl: "https://shell.example.com",
    opsBaseUrl: "",
  };

  // Drive the full driver (baseline GraphQL + healthcheck, then the
  // config GET) with a single seam that serves SUCCESS for GraphQL, 200
  // for every page GET, and the provided HTML body.
  function seamFor(html: string): FetchLike {
    return makeFetch((url) => {
      if (url.includes("/graphql/v2")) return gqlDeploymentResponse("SUCCESS");
      return Promise.resolve(mkResponse({ status: 200, text: html }));
    });
  }

  const target: ProbeTarget = {
    name: "dashboard",
    host: asHost(domainFor("dashboard", "prod")),
    driver: "dashboard",
  };

  it("passes when the injected config is healthy", async () => {
    await withGlobalSeam(
      seamFor(dashboardHtml(HEALTHY_CFG)),
      TOKEN,
      async () => {
        const out = await probeDashboard(target);
        expect(out.ok).toBe(true);
      },
    );
  });

  it("fails loud when shellUrl is the env-unset sentinel", async () => {
    await withGlobalSeam(
      seamFor(
        dashboardHtml({ ...HEALTHY_CFG, shellUrl: PROD_INVALID_SHELL_URL }),
      ),
      TOKEN,
      async () => {
        const out = await probeDashboard(target);
        expect(out.ok).toBe(false);
        if (out.ok === false) {
          expect(out.error).toMatch(/shellUrl/);
          expect(out.error).toContain(PROD_INVALID_SHELL_URL);
          expect(out.error).toMatch(/SHELL_URL/);
        }
      },
    );
  });

  it("fails loud when pocketbaseUrl is the env-unset sentinel", async () => {
    await withGlobalSeam(
      seamFor(
        dashboardHtml({
          ...HEALTHY_CFG,
          pocketbaseUrl: PROD_INVALID_POCKETBASE_URL,
        }),
      ),
      TOKEN,
      async () => {
        const out = await probeDashboard(target);
        expect(out.ok).toBe(false);
        if (out.ok === false) {
          expect(out.error).toMatch(/pocketbaseUrl/);
          expect(out.error).toContain(PROD_INVALID_POCKETBASE_URL);
        }
      },
    );
  });

  it("does NOT false-fail when the config block is absent from the page", async () => {
    await withGlobalSeam(
      seamFor("<html><body>rendered without a config block</body></html>"),
      TOKEN,
      async () => {
        const out = await probeDashboard(target);
        expect(out.ok).toBe(true);
      },
    );
  });

  it("fails when the config block is present but malformed JSON", async () => {
    await withGlobalSeam(
      seamFor(
        '<html><head><script id="__showcase_config__">window.__SHOWCASE_CONFIG__={broken};</script></head><body>ok</body></html>',
      ),
      TOKEN,
      async () => {
        const out = await probeDashboard(target);
        expect(out.ok).toBe(false);
        if (out.ok === false) expect(out.error).toMatch(/not valid JSON/);
      },
    );
  });

  it("passes when a config VALUE contains a `};` substring (no char-class truncation)", async () => {
    // A char-class body match (`\{[^<]*?\}`) truncates at the first `};`
    // inside a value, mis-parsing the config. The tag-boundary extractor must
    // capture the whole assignment so a value like "a};b" round-trips intact.
    await withGlobalSeam(
      seamFor(dashboardHtml({ ...HEALTHY_CFG, opsBaseUrl: "x};y" })),
      TOKEN,
      async () => {
        const out = await probeDashboard(target);
        expect(out.ok).toBe(true);
      },
    );
  });

  it("fails loud on format drift (trailing newline / missing semicolon in the injection)", async () => {
    // Old regex required a literal trailing `};` with no intervening
    // whitespace; a formatter that emits a trailing newline (or drops the
    // semicolon) made it no-match → silent PASS. The tag-boundary extractor
    // must still parse it (healthy) OR, if genuinely unparseable, throw —
    // never silent-pass. Here a parseable-but-no-trailing-semicolon, newline-
    // padded body must be parsed as the healthy config (round-trips ok).
    const json = JSON.stringify(HEALTHY_CFG);
    const driftedHtml = `<!doctype html><html><head><script id="__showcase_config__">\n  window.__SHOWCASE_CONFIG__ = ${json}\n</script></head><body>ok</body></html>`;
    await withGlobalSeam(seamFor(driftedHtml), TOKEN, async () => {
      const out = await probeDashboard(target);
      expect(out.ok).toBe(true);
    });
  });

  it("fails loud when the config is parseable but NOT an object (e.g. a scalar)", async () => {
    // A parseable non-object (here a JSON number) previously returned
    // `undefined`, which the caller treats as "block absent → pass". It must
    // now THROW like the bad-JSON branch so a format-drifted config fails loud.
    const nonObjHtml = `<!doctype html><html><head><script id="__showcase_config__">window.__SHOWCASE_CONFIG__=42;</script></head><body>ok</body></html>`;
    await withGlobalSeam(seamFor(nonObjHtml), TOKEN, async () => {
      const out = await probeDashboard(target);
      expect(out.ok).toBe(false);
      if (out.ok === false) {
        expect(out.error).toMatch(/config object|not valid JSON/);
      }
    });
  });

  it("surfaces a config-fetch failure as a probe error (after a green baseline)", async () => {
    // GraphQL + the baseline healthcheck succeed; the SECOND GET (the
    // config probe) throws. The dashboard driver must surface it, not
    // silently pass.
    let pageGets = 0;
    const seam = makeFetch((url) => {
      if (url.includes("/graphql/v2")) return gqlDeploymentResponse("SUCCESS");
      pageGets += 1;
      if (pageGets === 1) return Promise.resolve(mkResponse({ status: 200 }));
      throw new Error("connection refused");
    });
    await withGlobalSeam(seam, TOKEN, async () => {
      const out = await probeDashboard(target);
      expect(out.ok).toBe(false);
      if (out.ok === false) {
        expect(out.error).toMatch(/runtime-config GET/);
        expect(out.error).toMatch(/connection refused/);
      }
    });
  });
});
