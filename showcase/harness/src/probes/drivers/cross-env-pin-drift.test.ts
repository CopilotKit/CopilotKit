import { describe, it, expect } from "vitest";
import { crossEnvPinDriftDriver } from "./cross-env-pin-drift.js";
import type { Logger, ProbeContext } from "../../types/index.js";

// Driver-level tests for `crossEnvPinDriftDriver`. Unlike `image-drift`
// (one env's running digest vs GHCR `:latest`) and `pin-drift` (the
// validate-pins ratchet), this driver is CROSS-ENV: for each prod-pinned
// service it reads
//   - prod's PINNED ref            (serviceInstances[prod].source.image, `@sha256:…`)
//   - prod's RUNNING digest        (serviceInstances[prod].latestDeployment.meta.imageDigest)
//   - the GHCR presence of the pinned digest (manifest GET)
//   - staging's running digest     (reporting only; the floating side)
// and asserts prod is RUNNING what it was LAST PROMOTED to (pinned) AND
// that the pinned digest is still present in GHCR — NOT "matches :latest".

const PROD_ENV_ID = "b14919f4-6417-429f-848d-c6ae2201e04f";
const STAGING_ENV_ID = "8edfef02-ea09-4a20-8689-261f21cc2849";

const PINNED_DIGEST =
  "sha256:1111111111111111111111111111111111111111111111111111111111111111";
const DRIFTED_DIGEST =
  "sha256:2222222222222222222222222222222222222222222222222222222222222222";
const STAGING_DIGEST =
  "sha256:3333333333333333333333333333333333333333333333333333333333333333";

function captureLogger(): {
  logger: Logger;
  warnCalls: { msg: string; meta?: Record<string, unknown> }[];
  errorCalls: { msg: string; meta?: Record<string, unknown> }[];
} {
  const warnCalls: { msg: string; meta?: Record<string, unknown> }[] = [];
  const errorCalls: { msg: string; meta?: Record<string, unknown> }[] = [];
  const captured: Logger = {
    debug: () => {},
    info: () => {},
    warn: (msg, meta) => warnCalls.push({ msg, meta }),
    error: (msg, meta) => errorCalls.push({ msg, meta }),
  };
  return { logger: captured, warnCalls, errorCalls };
}

interface InstanceSpec {
  environmentId: string;
  image: string | null;
  /** Running digest published in latestDeployment.meta.imageDigest. */
  runningDigest?: string | null;
}

/**
 * Build a Railway project GraphQL response carrying one service with the
 * supplied per-env instances. Mirrors the shape `railway-services`
 * discovery parses (`project.services.edges[].node.serviceInstances`).
 */
function railwayProjectResponse(
  serviceName: string,
  instances: InstanceSpec[],
) {
  return {
    data: {
      project: {
        services: {
          edges: [
            {
              node: {
                id: "svc-1",
                name: serviceName,
                serviceInstances: {
                  edges: instances.map((inst) => ({
                    node: {
                      environmentId: inst.environmentId,
                      source: { image: inst.image },
                      domains: { serviceDomains: [] },
                      latestDeployment:
                        inst.runningDigest === undefined
                          ? null
                          : {
                              meta:
                                inst.runningDigest === null
                                  ? null
                                  : { imageDigest: inst.runningDigest },
                            },
                    },
                  })),
                },
              },
            },
          ],
        },
      },
    },
  };
}

interface ResponseSpec {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  throws?: Error;
}

/**
 * Scripted fetch: serves Railway (POST) and GHCR (GET) round-trips from a
 * queue in order. Queue exhaustion throws so a test asking for more
 * round-trips than scripted fails loud. Records both the request URLs AND
 * the per-call `init` (so tests can assert on the headers the driver
 * attaches, e.g. the GHCR `Authorization` bearer).
 */
function scriptedFetch(queue: ResponseSpec[]): {
  fetchImpl: typeof fetch;
  urls: string[];
  inits: (RequestInit | undefined)[];
} {
  const urls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  let idx = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    urls.push(typeof url === "string" ? url : url.toString());
    inits.push(init);
    const entry = queue[idx++];
    if (!entry) throw new Error("scriptedFetch: queue exhausted");
    if (entry.throws) throw entry.throws;
    const body =
      typeof entry.body === "string"
        ? entry.body
        : JSON.stringify(entry.body ?? {});
    return new Response(body, {
      status: entry.status,
      headers: entry.headers ?? { "content-type": "application/json" },
    });
  };
  return { fetchImpl, urls, inits };
}

/**
 * Read a single header value off a recorded `init.headers` regardless of
 * the shape the caller used (plain record, array of tuples, or `Headers`).
 * Returns undefined when the header is absent.
 */
function headerValue(
  init: RequestInit | undefined,
  name: string,
): string | undefined {
  const h = init?.headers;
  if (!h) return undefined;
  if (h instanceof Headers) return h.get(name) ?? undefined;
  if (Array.isArray(h)) {
    const match = h.find(([k]) => k.toLowerCase() === name.toLowerCase());
    return match?.[1];
  }
  const rec = h as Record<string, string>;
  const key = Object.keys(rec).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  return key ? rec[key] : undefined;
}

function makeCtx(
  fetchImpl: typeof fetch,
  loggerOverride?: Logger,
  envOverride?: Record<string, string | undefined>,
): ProbeContext & { fetchImpl: typeof fetch } {
  return {
    now: () => new Date("2026-06-19T00:00:00Z"),
    logger: loggerOverride ?? captureLogger().logger,
    env: envOverride ?? {
      RAILWAY_TOKEN: "rwtok",
      RAILWAY_PROJECT_ID: "proj-1",
    },
    fetchImpl,
  } as ProbeContext & { fetchImpl: typeof fetch };
}

function ghcrPresent(digest: string): ResponseSpec {
  return {
    status: 200,
    headers: {
      "docker-content-digest": digest,
      "content-type": "application/vnd.oci.image.manifest.v1+json",
    },
  };
}

const baseInput = {
  key: "pin_drift_cross_env:showcase-langgraph-python",
  name: "showcase-langgraph-python",
  imageRepo: "ghcr.io/copilotkit/showcase-langgraph-python",
  prodEnvId: PROD_ENV_ID,
  stagingEnvId: STAGING_ENV_ID,
};

describe("crossEnvPinDriftDriver", () => {
  it("exposes a stable kind string", () => {
    expect(typeof crossEnvPinDriftDriver.kind).toBe("string");
    expect(crossEnvPinDriftDriver.kind.length).toBeGreaterThan(0);
  });

  it("inputSchema requires key, name, imageRepo, and prodEnvId", () => {
    expect(
      crossEnvPinDriftDriver.inputSchema.safeParse(baseInput).success,
    ).toBe(true);
    expect(
      crossEnvPinDriftDriver.inputSchema.safeParse({
        key: baseInput.key,
        name: baseInput.name,
        imageRepo: baseInput.imageRepo,
      }).success,
    ).toBe(false);
  });

  it("GREEN: prod running digest equals last-promoted (pinned) digest and digest present in GHCR", async () => {
    const { fetchImpl } = scriptedFetch([
      {
        status: 200,
        body: railwayProjectResponse(baseInput.name, [
          {
            environmentId: PROD_ENV_ID,
            image: `${baseInput.imageRepo}@${PINNED_DIGEST}`,
            runningDigest: PINNED_DIGEST,
          },
          {
            environmentId: STAGING_ENV_ID,
            image: `${baseInput.imageRepo}:latest`,
            runningDigest: STAGING_DIGEST,
          },
        ]),
      },
      ghcrPresent(PINNED_DIGEST),
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await crossEnvPinDriftDriver.run(ctx, baseInput);
    expect(r.state).toBe("green");
    expect(r.key).toBe(baseInput.key);
    const signal = r.signal as Record<string, unknown>;
    expect(signal.status).toBe("stable");
    expect(signal.prodPinnedDigest).toBe(PINNED_DIGEST);
    expect(signal.prodRunningDigest).toBe(PINNED_DIGEST);
    expect(signal.stagingRunningDigest).toBe(STAGING_DIGEST);
    expect(signal.ghcrPresent).toBe(true);
  });

  it("RED (regressed): prod running digest drifted off the pinned/last-promoted digest", async () => {
    const { fetchImpl } = scriptedFetch([
      {
        status: 200,
        body: railwayProjectResponse(baseInput.name, [
          {
            environmentId: PROD_ENV_ID,
            image: `${baseInput.imageRepo}@${PINNED_DIGEST}`,
            runningDigest: DRIFTED_DIGEST,
          },
          {
            environmentId: STAGING_ENV_ID,
            image: `${baseInput.imageRepo}:latest`,
            runningDigest: STAGING_DIGEST,
          },
        ]),
      },
      ghcrPresent(PINNED_DIGEST),
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await crossEnvPinDriftDriver.run(ctx, baseInput);
    expect(r.state).toBe("red");
    const signal = r.signal as Record<string, unknown>;
    expect(signal.status).toBe("regressed");
    expect(signal.prodPinnedDigest).toBe(PINNED_DIGEST);
    expect(signal.prodRunningDigest).toBe(DRIFTED_DIGEST);
  });

  it("RED (alarm): the last-promoted (pinned) digest has been GC'd from GHCR", async () => {
    const { fetchImpl } = scriptedFetch([
      {
        status: 200,
        body: railwayProjectResponse(baseInput.name, [
          {
            environmentId: PROD_ENV_ID,
            image: `${baseInput.imageRepo}@${PINNED_DIGEST}`,
            runningDigest: PINNED_DIGEST,
          },
          {
            environmentId: STAGING_ENV_ID,
            image: `${baseInput.imageRepo}:latest`,
            runningDigest: STAGING_DIGEST,
          },
        ]),
      },
      // GHCR 404 — the pinned digest was garbage-collected.
      { status: 404, body: { errors: [{ code: "MANIFEST_UNKNOWN" }] } },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await crossEnvPinDriftDriver.run(ctx, baseInput);
    expect(r.state).toBe("red");
    const signal = r.signal as Record<string, unknown>;
    expect(signal.status).toBe("ghcr-missing");
    expect(signal.ghcrPresent).toBe(false);
  });

  it("RED: prod instance is not pinned (still on :latest)", async () => {
    const { fetchImpl } = scriptedFetch([
      {
        status: 200,
        body: railwayProjectResponse(baseInput.name, [
          {
            environmentId: PROD_ENV_ID,
            image: `${baseInput.imageRepo}:latest`,
            runningDigest: PINNED_DIGEST,
          },
        ]),
      },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await crossEnvPinDriftDriver.run(ctx, baseInput);
    expect(r.state).toBe("red");
    const signal = r.signal as Record<string, unknown>;
    expect(signal.status).toBe("unpinned");
  });

  it("error: prod service has no instance in the prod env", async () => {
    const { fetchImpl } = scriptedFetch([
      {
        status: 200,
        body: railwayProjectResponse(baseInput.name, [
          {
            environmentId: STAGING_ENV_ID,
            image: `${baseInput.imageRepo}:latest`,
            runningDigest: STAGING_DIGEST,
          },
        ]),
      },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await crossEnvPinDriftDriver.run(ctx, baseInput);
    expect(r.state).toBe("error");
    const signal = r.signal as Record<string, unknown>;
    expect(typeof signal.errorDesc).toBe("string");
  });

  it("error: Railway auth failure surfaces as a keyed error result", async () => {
    const { fetchImpl } = scriptedFetch([
      { status: 401, body: "unauthorized" },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await crossEnvPinDriftDriver.run(ctx, baseInput);
    expect(r.state).toBe("error");
    const signal = r.signal as Record<string, unknown>;
    expect(typeof signal.errorDesc).toBe("string");
  });

  it("error: missing Railway credentials in env", async () => {
    const { fetchImpl } = scriptedFetch([]);
    const ctx = makeCtx(fetchImpl, undefined, {});
    const r = await crossEnvPinDriftDriver.run(ctx, baseInput);
    expect(r.state).toBe("error");
  });

  it("error: Railway returns project: null", async () => {
    const { fetchImpl } = scriptedFetch([
      { status: 200, body: { data: { project: null } } },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await crossEnvPinDriftDriver.run(ctx, baseInput);
    expect(r.state).toBe("error");
    const signal = r.signal as Record<string, unknown>;
    expect(String(signal.errorDesc)).toContain("returned null");
  });

  it("error: Railway response fails the project schema", async () => {
    const { fetchImpl } = scriptedFetch([
      { status: 200, body: { data: { project: { services: "nope" } } } },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await crossEnvPinDriftDriver.run(ctx, baseInput);
    expect(r.state).toBe("error");
    const signal = r.signal as Record<string, unknown>;
    expect(String(signal.errorDesc)).toContain("did not match expected shape");
  });

  it("error: requested service is absent from the railway project", async () => {
    const { fetchImpl } = scriptedFetch([
      {
        status: 200,
        body: railwayProjectResponse("showcase-some-other-service", [
          {
            environmentId: PROD_ENV_ID,
            image: `${baseInput.imageRepo}@${PINNED_DIGEST}`,
            runningDigest: PINNED_DIGEST,
          },
        ]),
      },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await crossEnvPinDriftDriver.run(ctx, baseInput);
    expect(r.state).toBe("error");
    const signal = r.signal as Record<string, unknown>;
    expect(String(signal.errorDesc)).toContain("not found");
  });

  it("GREEN with no staging env id: staging digest reported as empty", async () => {
    const { fetchImpl } = scriptedFetch([
      {
        status: 200,
        body: railwayProjectResponse(baseInput.name, [
          {
            environmentId: PROD_ENV_ID,
            image: `${baseInput.imageRepo}@${PINNED_DIGEST}`,
            runningDigest: PINNED_DIGEST,
          },
        ]),
      },
      ghcrPresent(PINNED_DIGEST),
    ]);
    const ctx = makeCtx(fetchImpl);
    const { stagingEnvId: _omit, ...prodOnlyInput } = baseInput;
    const r = await crossEnvPinDriftDriver.run(ctx, prodOnlyInput);
    expect(r.state).toBe("green");
    const signal = r.signal as Record<string, unknown>;
    expect(signal.stagingRunningDigest).toBe("");
  });

  it("error: GHCR returns 401 auth failure on the pinned-digest lookup", async () => {
    const { fetchImpl } = scriptedFetch([
      {
        status: 200,
        body: railwayProjectResponse(baseInput.name, [
          {
            environmentId: PROD_ENV_ID,
            image: `${baseInput.imageRepo}@${PINNED_DIGEST}`,
            runningDigest: PINNED_DIGEST,
          },
        ]),
      },
      { status: 401, body: "unauthorized" },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await crossEnvPinDriftDriver.run(ctx, baseInput);
    expect(r.state).toBe("error");
    const signal = r.signal as Record<string, unknown>;
    expect(String(signal.errorDesc)).toContain("ghcr lookup failed");
  });

  it("error: GHCR returns a 500 on the pinned-digest lookup", async () => {
    const { fetchImpl } = scriptedFetch([
      {
        status: 200,
        body: railwayProjectResponse(baseInput.name, [
          {
            environmentId: PROD_ENV_ID,
            image: `${baseInput.imageRepo}@${PINNED_DIGEST}`,
            runningDigest: PINNED_DIGEST,
          },
        ]),
      },
      { status: 500, body: "boom" },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await crossEnvPinDriftDriver.run(ctx, baseInput);
    expect(r.state).toBe("error");
    const signal = r.signal as Record<string, unknown>;
    expect(String(signal.errorDesc)).toContain("ghcr manifest lookup 500");
  });

  it("error: GHCR fetch throws (transport failure) on the pinned-digest lookup", async () => {
    const { fetchImpl } = scriptedFetch([
      {
        status: 200,
        body: railwayProjectResponse(baseInput.name, [
          {
            environmentId: PROD_ENV_ID,
            image: `${baseInput.imageRepo}@${PINNED_DIGEST}`,
            runningDigest: PINNED_DIGEST,
          },
        ]),
      },
      { status: 0, throws: new Error("ECONNREFUSED") },
    ]);
    const ctx = makeCtx(fetchImpl);
    const r = await crossEnvPinDriftDriver.run(ctx, baseInput);
    expect(r.state).toBe("error");
    const signal = r.signal as Record<string, unknown>;
    expect(String(signal.errorDesc)).toContain("ghcr fetch failed");
  });

  it("attaches GHCR Authorization header when GHCR_TOKEN is present", async () => {
    const { fetchImpl, urls, inits } = scriptedFetch([
      {
        status: 200,
        body: railwayProjectResponse(baseInput.name, [
          {
            environmentId: PROD_ENV_ID,
            image: `${baseInput.imageRepo}@${PINNED_DIGEST}`,
            runningDigest: PINNED_DIGEST,
          },
        ]),
      },
      ghcrPresent(PINNED_DIGEST),
    ]);
    const ctx = makeCtx(fetchImpl, undefined, {
      RAILWAY_TOKEN: "rwtok",
      RAILWAY_PROJECT_ID: "proj-1",
      GHCR_TOKEN: "ghp_test",
    });
    const r = await crossEnvPinDriftDriver.run(ctx, baseInput);
    expect(r.state).toBe("green");
    // The second round-trip targets the GHCR manifest endpoint for the
    // pinned digest.
    expect(urls[1]).toContain(
      "ghcr.io/v2/copilotkit/showcase-langgraph-python",
    );
    expect(urls[1]).toContain(encodeURIComponent(PINNED_DIGEST));
    // …and it MUST carry the GHCR bearer derived from GHCR_TOKEN. This is
    // the load-bearing assertion: if the driver ever drops the header the
    // test fails (the URL alone can't catch that regression).
    expect(headerValue(inits[1], "Authorization")).toBe("Bearer ghp_test");
  });

  it("omits the GHCR Authorization header when GHCR_TOKEN is absent", async () => {
    const { fetchImpl, inits } = scriptedFetch([
      {
        status: 200,
        body: railwayProjectResponse(baseInput.name, [
          {
            environmentId: PROD_ENV_ID,
            image: `${baseInput.imageRepo}@${PINNED_DIGEST}`,
            runningDigest: PINNED_DIGEST,
          },
        ]),
      },
      ghcrPresent(PINNED_DIGEST),
    ]);
    // makeCtx's default env has no GHCR_TOKEN.
    const ctx = makeCtx(fetchImpl);
    const r = await crossEnvPinDriftDriver.run(ctx, baseInput);
    expect(r.state).toBe("green");
    expect(headerValue(inits[1], "Authorization")).toBeUndefined();
  });
});
