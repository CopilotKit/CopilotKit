import { describe, it, expect, vi } from "vitest";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyShape,
  railwayServicesSource,
  resolveShape,
} from "./railway-services.js";
import {
  DiscoverySourceAuthError,
  DiscoverySourceBackendError,
  DiscoverySourceSchemaError,
  DiscoverySourceTransportError,
} from "./errors.js";
import { logger } from "../../logger.js";
import type { DiscoveryContext } from "../types.js";

// Helpers -------------------------------------------------------------------

interface CallRecord {
  body: string;
}

/**
 * Build a scripted fetch-mock that returns responses from a queue in order.
 * Each entry is either a full `Response` or an object describing status +
 * body + headers. Queue exhaustion throws so a test asking for more
 * round-trips than scripted fails loud rather than silently stubbing a
 * default response.
 */
function makeFetch(
  queue: Array<
    { status: number; body: unknown; contentType?: string } | { throws: Error }
  >,
): { fetchImpl: typeof fetch; calls: CallRecord[] } {
  const calls: CallRecord[] = [];
  let idx = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ body });
    if (idx >= queue.length) {
      throw new Error(
        `makeFetch: queue exhausted at call ${idx + 1} (queue size ${queue.length})`,
      );
    }
    const entry = queue[idx++]!;
    if ("throws" in entry) throw entry.throws;
    const contentType = entry.contentType ?? "application/json";
    const bodyStr =
      typeof entry.body === "string" ? entry.body : JSON.stringify(entry.body);
    return new Response(bodyStr, {
      status: entry.status,
      headers: { "content-type": contentType },
    });
  };
  return { fetchImpl, calls };
}

function railwayProjectResponse(
  services: Array<{
    id: string;
    name: string;
    image: string | null;
    domain?: string | null;
    variables?: Record<string, string>;
  }>,
) {
  return {
    data: {
      project: {
        services: {
          edges: services.map((s) => ({
            node: {
              id: s.id,
              name: s.name,
              serviceInstances: {
                edges: [
                  {
                    node: {
                      environmentId: "env-1",
                      source: { image: s.image },
                      domains: {
                        serviceDomains: s.domain ? [{ domain: s.domain }] : [],
                      },
                    },
                  },
                ],
              },
            },
          })),
        },
      },
    },
  };
}

const BASE_ENV = {
  RAILWAY_TOKEN: "rw-test",
  RAILWAY_PROJECT_ID: "proj-1",
  RAILWAY_ENVIRONMENT_ID: "env-1",
};

function makeCtx(
  fetchImpl: typeof fetch,
  env: Record<string, string | undefined> = BASE_ENV,
): DiscoveryContext {
  return { fetchImpl, logger, env };
}

// Tests ---------------------------------------------------------------------

describe("railwayServicesSource", () => {
  it("exposes name === 'railway-services'", () => {
    expect(railwayServicesSource.name).toBe("railway-services");
  });

  it("configSchema accepts empty object", () => {
    const parsed = railwayServicesSource.configSchema.safeParse({});
    expect(parsed.success).toBe(true);
  });

  it("configSchema accepts a filter with namePrefix + labels", () => {
    // configSchema is the filter block itself — the invoker hands
    // `cfg.discovery.filter` to enumerate() directly, so the schema
    // parses `{namePrefix, labels, nameExcludes}` at the top level
    // rather than nested under a `filter:` key.
    const parsed = railwayServicesSource.configSchema.safeParse({
      namePrefix: "showcase-",
      labels: { env: "prod" },
    });
    expect(parsed.success).toBe(true);
  });

  it("happy path: enumerates multiple services with imageRef + publicUrl + env", async () => {
    const { fetchImpl } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          {
            id: "s-1",
            name: "showcase-a",
            image: "ghcr.io/copilotkit/showcase-a:latest",
            domain: "showcase-a.up.railway.app",
          },
          {
            id: "s-2",
            name: "showcase-b",
            image: "ghcr.io/copilotkit/showcase-b:latest",
            domain: "showcase-b.up.railway.app",
          },
        ]),
      },
      {
        status: 200,
        body: { data: { variables: { FOO: "bar" } } },
      },
      {
        status: 200,
        body: { data: { variables: { BAZ: "qux" } } },
      },
    ]);
    const out = await railwayServicesSource.enumerate(makeCtx(fetchImpl), {});
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      name: "showcase-a",
      imageRef: "ghcr.io/copilotkit/showcase-a:latest",
      publicUrl: "https://showcase-a.up.railway.app",
    });
    expect(out[0].env).toEqual({ FOO: "bar" });
    expect(out[1].name).toBe("showcase-b");
  });

  it("filters by namePrefix, dropping non-matching services before env fetch", async () => {
    const { fetchImpl, calls } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          {
            id: "s-1",
            name: "showcase-a",
            image: "ghcr.io/copilotkit/showcase-a:latest",
            domain: "showcase-a.up.railway.app",
          },
          {
            id: "s-2",
            name: "other-b",
            image: "ghcr.io/copilotkit/other-b:latest",
            domain: "other-b.up.railway.app",
          },
        ]),
      },
      // Only one variables call should happen because only one service
      // passes the namePrefix filter.
      { status: 200, body: { data: { variables: {} } } },
    ]);
    const out = await railwayServicesSource.enumerate(makeCtx(fetchImpl), {
      namePrefix: "showcase-",
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("showcase-a");
    // Round-trips: 1 project query + 1 variables query only.
    expect(calls).toHaveLength(2);
  });

  it("filters by nameExcludes, dropping excluded services after namePrefix", async () => {
    // Applied AFTER namePrefix so the exclude list can target infra
    // services (showcase-aimock, showcase-ops, ...) without having to
    // maintain a parallel include-list — the e2e-smoke probe uses this
    // to skip services that don't run user-facing demos.
    const { fetchImpl, calls } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          {
            id: "s-1",
            name: "showcase-langgraph-python",
            image: "ghcr.io/copilotkit/showcase-langgraph-python:latest",
            domain: "showcase-langgraph-python.up.railway.app",
          },
          {
            id: "s-2",
            name: "showcase-aimock",
            image: "ghcr.io/copilotkit/showcase-aimock:latest",
            domain: "showcase-aimock.up.railway.app",
          },
        ]),
      },
      // Only one variables call — the excluded service should not fetch vars.
      { status: 200, body: { data: { variables: {} } } },
    ]);
    const out = await railwayServicesSource.enumerate(makeCtx(fetchImpl), {
      namePrefix: "showcase-",
      nameExcludes: ["showcase-aimock"],
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("showcase-langgraph-python");
    expect(calls).toHaveLength(2);
  });

  it("honours filter passed flat (invoker shape) — drops all 7 infra services in smoke.yml", async () => {
    // REGRESSION: the probe-invoker at `loader/probe-invoker.ts` calls
    // `source.enumerate(ctx, cfg.discovery.filter ?? {})` — i.e. it passes
    // the FILTER OBJECT DIRECTLY, not a `{filter: {...}}` wrapper. The
    // previous ConfigSchema wrapped FilterSchema in an outer `.filter`
    // key, so at runtime `cfg.filter` was undefined, BOTH `namePrefix`
    // and `nameExcludes` silently defaulted to undefined, and all 7
    // infra services (showcase-shell*, showcase-ops, showcase-pocketbase,
    // showcase-aimock) produced smoke:/health:/agent: ProbeResults every
    // tick → ~21 false-red rows in PocketBase.
    //
    // This test asserts the contract DiscoverySource.enumerate advertises
    // in `probes/types.ts`: the second argument is `discovery.filter`,
    // not the whole discovery block.
    const { fetchImpl, calls } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          // Real user-facing showcase services — MUST be enumerated.
          {
            id: "s-1",
            name: "showcase-langgraph-python",
            image: "ghcr.io/copilotkit/showcase-langgraph-python:latest",
            domain: "showcase-langgraph-python.up.railway.app",
          },
          {
            id: "s-2",
            name: "showcase-ag2",
            image: "ghcr.io/copilotkit/showcase-ag2:latest",
            domain: "showcase-ag2.up.railway.app",
          },
          // The 7 infra services from smoke.yml's `nameExcludes` — MUST
          // be dropped before per-service env fetch.
          {
            id: "i-1",
            name: "showcase-ops",
            image: "ghcr.io/copilotkit/showcase-ops:latest",
            domain: "showcase-ops.up.railway.app",
          },
          {
            id: "i-2",
            name: "showcase-pocketbase",
            image: "ghcr.io/copilotkit/showcase-pocketbase:latest",
            domain: "showcase-pocketbase.up.railway.app",
          },
          {
            id: "i-3",
            name: "showcase-shell",
            image: "ghcr.io/copilotkit/showcase-shell:latest",
            domain: "showcase-shell.up.railway.app",
          },
          {
            id: "i-4",
            name: "showcase-shell-dashboard",
            image: "ghcr.io/copilotkit/showcase-shell-dashboard:latest",
            domain: "showcase-shell-dashboard.up.railway.app",
          },
          {
            id: "i-5",
            name: "showcase-shell-docs",
            image: "ghcr.io/copilotkit/showcase-shell-docs:latest",
            domain: "showcase-shell-docs.up.railway.app",
          },
          {
            id: "i-6",
            name: "showcase-shell-dojo",
            image: "ghcr.io/copilotkit/showcase-shell-dojo:latest",
            domain: "showcase-shell-dojo.up.railway.app",
          },
          {
            id: "i-7",
            name: "showcase-aimock",
            image: "ghcr.io/copilotkit/showcase-aimock:latest",
            domain: "showcase-aimock.up.railway.app",
          },
        ]),
      },
      // Only TWO variables calls — one per user-facing showcase. If
      // excludes leak, the queue exhausts and makeFetch throws.
      { status: 200, body: { data: { variables: {} } } },
      { status: 200, body: { data: { variables: {} } } },
    ]);
    // Invoker shape: flat filter object, no `{filter: ...}` wrapper.
    const out = await railwayServicesSource.enumerate(makeCtx(fetchImpl), {
      namePrefix: "showcase-",
      nameExcludes: [
        "showcase-ops",
        "showcase-pocketbase",
        "showcase-shell",
        "showcase-shell-dashboard",
        "showcase-shell-docs",
        "showcase-shell-dojo",
        "showcase-aimock",
      ],
    });
    expect(out.map((s) => s.name).sort()).toEqual([
      "showcase-ag2",
      "showcase-langgraph-python",
    ]);
    // Project query + two per-service env queries only; the 7 infra
    // services must not cost a round-trip each.
    expect(calls).toHaveLength(3);
  });

  it("returns [] when namePrefix matches nothing (no variables calls)", async () => {
    const { fetchImpl, calls } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          {
            id: "s-1",
            name: "other-a",
            image: "ghcr.io/copilotkit/other-a:latest",
            domain: "other-a.up.railway.app",
          },
        ]),
      },
    ]);
    const out = await railwayServicesSource.enumerate(makeCtx(fetchImpl), {
      namePrefix: "showcase-",
    });
    expect(out).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("throws DiscoverySourceAuthError on 401", async () => {
    const { fetchImpl } = makeFetch([
      { status: 401, body: { errors: [{ message: "unauthenticated" }] } },
    ]);
    await expect(
      railwayServicesSource.enumerate(makeCtx(fetchImpl), {}),
    ).rejects.toBeInstanceOf(DiscoverySourceAuthError);
  });

  it("throws DiscoverySourceAuthError on 403", async () => {
    const { fetchImpl } = makeFetch([
      { status: 403, body: { errors: [{ message: "forbidden" }] } },
    ]);
    await expect(
      railwayServicesSource.enumerate(makeCtx(fetchImpl), {}),
    ).rejects.toBeInstanceOf(DiscoverySourceAuthError);
  });

  it("throws DiscoverySourceBackendError on 500", async () => {
    const { fetchImpl } = makeFetch([
      { status: 500, body: "internal error", contentType: "text/plain" },
    ]);
    await expect(
      railwayServicesSource.enumerate(makeCtx(fetchImpl), {}),
    ).rejects.toBeInstanceOf(DiscoverySourceBackendError);
  });

  it("throws DiscoverySourceBackendError on non-auth 4xx (e.g. 404)", async () => {
    const { fetchImpl } = makeFetch([
      { status: 404, body: { errors: [{ message: "not found" }] } },
    ]);
    await expect(
      railwayServicesSource.enumerate(makeCtx(fetchImpl), {}),
    ).rejects.toBeInstanceOf(DiscoverySourceBackendError);
  });

  it("throws DiscoverySourceTransportError when fetch throws (ECONNREFUSED)", async () => {
    const err: Error & { code?: string } = new Error("connect ECONNREFUSED");
    err.code = "ECONNREFUSED";
    const { fetchImpl } = makeFetch([{ throws: err }]);
    await expect(
      railwayServicesSource.enumerate(makeCtx(fetchImpl), {}),
    ).rejects.toBeInstanceOf(DiscoverySourceTransportError);
  });

  it("throws DiscoverySourceSchemaError on malformed JSON body", async () => {
    const { fetchImpl } = makeFetch([
      { status: 200, body: "not-json{{{", contentType: "application/json" },
    ]);
    await expect(
      railwayServicesSource.enumerate(makeCtx(fetchImpl), {}),
    ).rejects.toBeInstanceOf(DiscoverySourceSchemaError);
  });

  it("throws DiscoverySourceSchemaError on missing project.services field", async () => {
    const { fetchImpl } = makeFetch([
      { status: 200, body: { data: { project: null } } },
    ]);
    await expect(
      railwayServicesSource.enumerate(makeCtx(fetchImpl), {}),
    ).rejects.toBeInstanceOf(DiscoverySourceSchemaError);
  });

  it("throws DiscoverySourceAuthError when env credentials are missing", async () => {
    const { fetchImpl } = makeFetch([]);
    await expect(
      railwayServicesSource.enumerate(makeCtx(fetchImpl, {}), {}),
    ).rejects.toBeInstanceOf(DiscoverySourceAuthError);
  });

  it("concurrent enumerate() calls don't share mutable state", async () => {
    // Each enumerate() creates its own fetch-driven adapter — running 5 in
    // parallel with distinct ctxs + distinct response queues must produce
    // 5 distinct result arrays, no cross-contamination.
    const runs = Array.from({ length: 5 }, (_, i) => {
      const { fetchImpl } = makeFetch([
        {
          status: 200,
          body: railwayProjectResponse([
            {
              id: `s-${i}`,
              name: `showcase-${i}`,
              image: `ghcr.io/copilotkit/showcase-${i}:latest`,
              domain: `showcase-${i}.up.railway.app`,
            },
          ]),
        },
        { status: 200, body: { data: { variables: { RUN: String(i) } } } },
      ]);
      return railwayServicesSource.enumerate(makeCtx(fetchImpl), {});
    });
    const results = await Promise.all(runs);
    expect(results).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(results[i]).toHaveLength(1);
      expect(results[i][0].name).toBe(`showcase-${i}`);
      expect(results[i][0].env).toEqual({ RUN: String(i) });
    }
  });

  it("maps sealed Railway variables ('*****') to __SEALED__ sentinel", async () => {
    const { fetchImpl } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          {
            id: "s-1",
            name: "showcase-a",
            image: "ghcr.io/copilotkit/showcase-a:latest",
            domain: "showcase-a.up.railway.app",
          },
        ]),
      },
      {
        status: 200,
        body: {
          data: { variables: { OPEN: "plain", SECRET: "*****" } },
        },
      },
    ]);
    const out = await railwayServicesSource.enumerate(makeCtx(fetchImpl), {});
    expect(out[0].env).toEqual({ OPEN: "plain", SECRET: "__SEALED__" });
  });

  it("handles services without a public domain (publicUrl = '')", async () => {
    const { fetchImpl } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          {
            id: "s-1",
            name: "showcase-a",
            image: "ghcr.io/copilotkit/showcase-a:latest",
            domain: null,
          },
        ]),
      },
      { status: 200, body: { data: { variables: {} } } },
    ]);
    const out = await railwayServicesSource.enumerate(makeCtx(fetchImpl), {});
    expect(out[0].publicUrl).toBe("");
  });

  it("degrades per-service env to {} when variables query throws (partial-failure resilience)", async () => {
    // One of three variables fetches throws. The service's entry must
    // still appear in the output with `env: {}` rather than the whole
    // tick aborting — mirrors aimock-wiring's per-service try/catch
    // pattern.
    const transportErr = new Error("socket hangup");
    const { fetchImpl } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          {
            id: "s-1",
            name: "showcase-a",
            image: "ghcr.io/copilotkit/showcase-a:latest",
            domain: "showcase-a.up.railway.app",
          },
          {
            id: "s-2",
            name: "showcase-b",
            image: "ghcr.io/copilotkit/showcase-b:latest",
            domain: "showcase-b.up.railway.app",
          },
        ]),
      },
      { throws: transportErr },
      { status: 200, body: { data: { variables: { OK: "yes" } } } },
    ]);
    const out = await railwayServicesSource.enumerate(makeCtx(fetchImpl), {});
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("showcase-a");
    expect(out[0].env).toEqual({});
    expect(out[1].name).toBe("showcase-b");
    expect(out[1].env).toEqual({ OK: "yes" });
  });

  it("degrades per-service env to {} when variables response fails schema check", async () => {
    const { fetchImpl } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          {
            id: "s-1",
            name: "showcase-a",
            image: "ghcr.io/copilotkit/showcase-a:latest",
            domain: "showcase-a.up.railway.app",
          },
        ]),
      },
      // `variables` expected to be a flat string record; an array here
      // fails the Zod check and the source swallows + continues with {}.
      { status: 200, body: { data: { variables: ["not", "a", "map"] } } },
    ]);
    const out = await railwayServicesSource.enumerate(makeCtx(fetchImpl), {});
    expect(out).toHaveLength(1);
    expect(out[0].env).toEqual({});
  });

  // -----------------------------------------------------------------
  // Regression: Railway's current schema does NOT accept the
  // `environmentId` argument on `Service.serviceInstances`. Sending it
  // raises a GraphQL validation error (observed in production:
  //   "Unknown argument \"environmentId\" on field
  //    \"Service.serviceInstances\"")
  // which surfaces as a 400 and blocks every discovery tick. The source
  // MUST filter instances by environment client-side instead of passing
  // an argument to the field.
  // -----------------------------------------------------------------
  it("omits environmentId arg from Service.serviceInstances selection to match current Railway schema", async () => {
    // Simulate Railway's actual behaviour: reject any query that passes
    // `environmentId` as an argument to `serviceInstances`, accept the
    // arg-less form. Under the pre-fix code this queue runs the 400
    // branch and the source throws a backend error; under the fix it
    // runs the 200 branch and returns the service list.
    const fetchImpl: typeof fetch = async (_url, init) => {
      const raw = (init as RequestInit | undefined)?.body as string | undefined;
      const parsed = raw
        ? (JSON.parse(raw) as { query: string })
        : { query: "" };
      // Project-level query: validate shape against live Railway schema.
      if (parsed.query.includes("query project")) {
        if (/serviceInstances\s*\(/.test(parsed.query)) {
          return new Response(
            JSON.stringify({
              errors: [
                {
                  message:
                    'Unknown argument "environmentId" on field "Service.serviceInstances".',
                  extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
                },
              ],
            }),
            {
              status: 400,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return new Response(
          JSON.stringify(
            railwayProjectResponse([
              {
                id: "s-1",
                name: "showcase-a",
                image: "ghcr.io/copilotkit/showcase-a:latest",
                domain: "showcase-a.up.railway.app",
              },
            ]),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // Variables round-trip.
      return new Response(JSON.stringify({ data: { variables: {} } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const out = await railwayServicesSource.enumerate(makeCtx(fetchImpl), {});
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("showcase-a");
  });

  it("throws DiscoverySourceBackendError on 200 envelope with graphql errors[]", async () => {
    // Railway can return HTTP 200 with { errors: [...] } for invalid
    // queries or permission errors. These must surface as a backend
    // error (synthetic 500 status) so the invoker produces a keyed
    // synthetic-error ProbeResult rather than silently handing back an
    // empty service list.
    const { fetchImpl } = makeFetch([
      {
        status: 200,
        body: { errors: [{ message: "Project not found" }] },
      },
    ]);
    await expect(
      railwayServicesSource.enumerate(makeCtx(fetchImpl), {}),
    ).rejects.toBeInstanceOf(DiscoverySourceBackendError);
  });

  it("emits imageRef === '' when serviceInstance has no image source", async () => {
    const { fetchImpl } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          {
            id: "s-1",
            name: "showcase-a",
            image: null,
            domain: "showcase-a.up.railway.app",
          },
        ]),
      },
      { status: 200, body: { data: { variables: {} } } },
    ]);
    const out = await railwayServicesSource.enumerate(makeCtx(fetchImpl), {});
    expect(out[0].imageRef).toBe("");
  });

  // -----------------------------------------------------------------
  // Shape classification: starter vs. package
  //
  // Each discovered service is tagged with `shape: "package" | "starter"`
  // so downstream drivers (smoke, e2e-smoke) can branch on the URL
  // surface without re-parsing the service name. Starters mount as a
  // single-app integration at `/` with health at `/api/health`; packages
  // are the shell-based showcases with `/smoke`, `/health`, and
  // `/demos/*` routing. Without the field, probes hit `/smoke` on every
  // starter and emit one false-red row per starter per probed endpoint.
  // -----------------------------------------------------------------

  it("tags services whose name starts with `showcase-starter-` as shape='starter'", async () => {
    const { fetchImpl } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          {
            id: "s-1",
            name: "showcase-starter-ag2",
            image: "ghcr.io/copilotkit/showcase-starter-ag2:latest",
            domain: "showcase-starter-ag2-production.up.railway.app",
          },
        ]),
      },
      { status: 200, body: { data: { variables: {} } } },
    ]);
    const out = await railwayServicesSource.enumerate(makeCtx(fetchImpl), {});
    expect(out).toHaveLength(1);
    expect(out[0].shape).toBe("starter");
  });

  it("tags non-starter `showcase-*` services as shape='package'", async () => {
    const { fetchImpl } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          {
            id: "s-1",
            name: "showcase-langgraph-python",
            image: "ghcr.io/copilotkit/showcase-langgraph-python:latest",
            domain: "showcase-langgraph-python.up.railway.app",
          },
        ]),
      },
      { status: 200, body: { data: { variables: {} } } },
    ]);
    const out = await railwayServicesSource.enumerate(makeCtx(fetchImpl), {});
    expect(out).toHaveLength(1);
    expect(out[0].shape).toBe("package");
  });

  it("classifies a mixed batch of starter + package services correctly without any warn", async () => {
    // Regression guard: prior iteration silently produced warns on the
    // hyphen-bearing package names below. The return-value check is not
    // enough — we also assert the classifier logger was not invoked,
    // otherwise the audit warn fires every tick in production.
    const warn = vi.fn();
    const ctxLogger = { ...logger, warn };
    const { fetchImpl } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          {
            id: "s-1",
            name: "showcase-ag2",
            image: "ghcr.io/copilotkit/showcase-ag2:latest",
            domain: "showcase-ag2.up.railway.app",
          },
          {
            id: "s-2",
            name: "showcase-starter-ag2",
            image: "ghcr.io/copilotkit/showcase-starter-ag2:latest",
            domain: "showcase-starter-ag2-production.up.railway.app",
          },
          {
            id: "s-3",
            name: "showcase-langgraph-python",
            image: "ghcr.io/copilotkit/showcase-langgraph-python:latest",
            domain: "showcase-langgraph-python.up.railway.app",
          },
          {
            id: "s-4",
            name: "showcase-starter-mastra",
            image: "ghcr.io/copilotkit/showcase-starter-mastra:latest",
            domain: "showcase-starter-mastra-production.up.railway.app",
          },
        ]),
      },
      { status: 200, body: { data: { variables: {} } } },
      { status: 200, body: { data: { variables: {} } } },
      { status: 200, body: { data: { variables: {} } } },
      { status: 200, body: { data: { variables: {} } } },
    ]);
    const out = await railwayServicesSource.enumerate(
      { fetchImpl, logger: ctxLogger, env: BASE_ENV },
      {},
    );
    expect(out).toHaveLength(4);
    const byName = Object.fromEntries(out.map((s) => [s.name, s.shape]));
    expect(byName["showcase-ag2"]).toBe("package");
    expect(byName["showcase-starter-ag2"]).toBe("starter");
    expect(byName["showcase-langgraph-python"]).toBe("package");
    expect(byName["showcase-starter-mastra"]).toBe("starter");
    // No name-shape-unknown warn should have fired — every name above
    // matches either the starter or widened-package regex.
    const shapeWarns = warn.mock.calls.filter(
      (c) => c[0] === "discovery.railway-services.name-shape-unknown",
    );
    expect(shapeWarns).toHaveLength(0);
  });

  // -----------------------------------------------------------------
  // Audit-warn branch on classifyShape: any `showcase-*` name that is
  // neither a well-formed `showcase-starter-<slug>` nor a well-formed
  // package root `showcase-<slug>` (lowercase-alnum-hyphen) falls to
  // `package` but logs an audit warn. Covers typos like
  // `showcase-strater-foo`, underscore forms, and future archetypes
  // that would otherwise silently misclassify.
  // -----------------------------------------------------------------

  it("classifyShape warns on an underscore-form `showcase_starter_*` name but still returns 'package'", () => {
    // Underscore forms fail both regexes because the package pattern
    // only allows hyphens. The widened multi-segment package pattern
    // can no longer distinguish typos that happen to be hyphen-shaped
    // (`showcase-strater-foo` is now accepted as a valid package name
    // — indistinguishable from legit multi-segment names like
    // `showcase-langgraph-python`) so the warn-on-typo assertion
    // migrates to a structurally-invalid form instead.
    const warn = vi.fn();
    const shape = classifyShape("showcase_starter_ag2", { logger: { warn } });
    expect(shape).toBe("package");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "discovery.railway-services.name-shape-unknown",
      { name: "showcase_starter_ag2" },
    );
  });

  it("classifyShape does not warn on a well-formed package root", () => {
    const warn = vi.fn();
    const shape = classifyShape("showcase-ag2", { logger: { warn } });
    expect(shape).toBe("package");
    expect(warn).not.toHaveBeenCalled();
  });

  it("classifyShape does not warn on a well-formed starter name", () => {
    const warn = vi.fn();
    const shape = classifyShape("showcase-starter-ag2", { logger: { warn } });
    expect(shape).toBe("starter");
    expect(warn).not.toHaveBeenCalled();
  });

  // Hyphen-bearing multi-segment package names. The prior single-segment
  // regex (`^showcase-[a-z0-9]+$`) rejected these and fired a warn per
  // tick for real production services. Widened pattern accepts them as
  // `"package"` without warning.
  it("classifyShape returns 'package' on `showcase-langgraph-python` without warning", () => {
    const warn = vi.fn();
    const shape = classifyShape("showcase-langgraph-python", {
      logger: { warn },
    });
    expect(shape).toBe("package");
    expect(warn).not.toHaveBeenCalled();
  });

  it("classifyShape returns 'package' on `showcase-claude-sdk-typescript` without warning", () => {
    const warn = vi.fn();
    const shape = classifyShape("showcase-claude-sdk-typescript", {
      logger: { warn },
    });
    expect(shape).toBe("package");
    expect(warn).not.toHaveBeenCalled();
  });

  it("classifyShape returns 'package' on `showcase-ms-agent-dotnet` without warning", () => {
    const warn = vi.fn();
    const shape = classifyShape("showcase-ms-agent-dotnet", {
      logger: { warn },
    });
    expect(shape).toBe("package");
    expect(warn).not.toHaveBeenCalled();
  });

  // Non-`showcase-*` names also trip the warn. A Railway service renamed
  // to drop the prefix, or an unrelated workload picked up by discovery,
  // otherwise silently gets the package contract and floods /smoke 404s.
  it("classifyShape warns on a non-`showcase-*` name but still returns 'package'", () => {
    const warn = vi.fn();
    const shape = classifyShape("my-random-service", { logger: { warn } });
    expect(shape).toBe("package");
    expect(warn).toHaveBeenCalledWith(
      "discovery.railway-services.name-shape-unknown",
      { name: "my-random-service" },
    );
  });

  it("classifyShape warns on a `copilotkit-*` workload name but still returns 'package'", () => {
    const warn = vi.fn();
    const shape = classifyShape("copilotkit-cloud", { logger: { warn } });
    expect(shape).toBe("package");
    expect(warn).toHaveBeenCalledWith(
      "discovery.railway-services.name-shape-unknown",
      { name: "copilotkit-cloud" },
    );
  });

  it("classifyShape warns on a mixed-case `showcase-*` name but still returns 'package'", () => {
    const warn = vi.fn();
    const shape = classifyShape("ShowCase-Ag2", { logger: { warn } });
    expect(shape).toBe("package");
    expect(warn).toHaveBeenCalledWith(
      "discovery.railway-services.name-shape-unknown",
      { name: "ShowCase-Ag2" },
    );
  });

  it("resolveShape debug-logs when neither name nor shape is supplied", () => {
    const debug = vi.fn();
    const shape = resolveShape({}, { logger: { debug } });
    expect(shape).toBe("package");
    expect(debug).toHaveBeenCalledWith(
      "discovery.railway-services.resolve-shape-fallback",
      { reason: "no-name-or-shape" },
    );
  });

  it("threads ctx.abortSignal into every Railway GraphQL fetch", async () => {
    // Invariant: a slow Railway endpoint must not keep sockets open past
    // the invoker's per-tick timeout. The source plumbs `ctx.abortSignal`
    // into every GraphQL round-trip; this test captures `init.signal` on
    // every fetch and asserts the controller signal ctx carries is the
    // one the source forwards.
    const captured: Array<AbortSignal | undefined> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      captured.push((init as RequestInit | undefined)?.signal ?? undefined);
      const raw = (init as RequestInit | undefined)?.body as string | undefined;
      const parsed = raw
        ? (JSON.parse(raw) as { query: string })
        : { query: "" };
      if (parsed.query.includes("query project")) {
        return new Response(
          JSON.stringify(
            railwayProjectResponse([
              {
                id: "s1",
                name: "showcase-a",
                image: "ghcr.io/c/a:v1",
                domain: "a.up.railway.app",
              },
            ]),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: { variables: {} } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const controller = new AbortController();
    const ctx: DiscoveryContext = {
      fetchImpl,
      logger,
      env: BASE_ENV,
      abortSignal: controller.signal,
    };
    await railwayServicesSource.enumerate(ctx, {});
    expect(captured.length).toBeGreaterThan(0);
    for (const sig of captured) {
      expect(sig).toBe(controller.signal);
    }
  });

  // -----------------------------------------------------------------
  // Demos enrichment from registry.json
  //
  // The `e2e_demos` probe sorts services by demo count BEFORE the
  // worker pool picks them up — that sort lives in the probe-invoker
  // and reads `input.demos`. The driver's lazy `demosResolver` runs
  // INSIDE the driver, AFTER dispatch, so it cannot feed the sort. To
  // make the documented "shortest-first" behaviour actually trigger in
  // production, the discovery source reads `registry.json` once per
  // enumerate() call and joins demos by slug onto every emitted record.
  //
  // Resilience: if the registry is unreadable, the source MUST log a
  // structured warning and emit `demos: []` for every record (siblings
  // need to keep working even when the registry is missing).
  // -----------------------------------------------------------------

  /**
   * Write a registry.json to a temp dir and return the path. Tests pass
   * the path through `REGISTRY_JSON_PATH` so the source overrides the
   * default `/app/data/registry.json` location.
   */
  async function writeRegistry(content: string): Promise<string> {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), "railway-services-test-"),
    );
    const file = path.join(dir, "registry.json");
    await fsp.writeFile(file, content, "utf-8");
    return file;
  }

  it("joins demos by slug from registry.json (happy path)", async () => {
    const registryPath = await writeRegistry(
      JSON.stringify({
        integrations: [
          {
            slug: "ag2",
            demos: [
              { id: "agentic-chat" },
              { id: "human-in-the-loop" },
              { id: "tool-based-generative-ui" },
            ],
          },
          {
            slug: "langgraph-python",
            demos: [{ id: "agentic-chat" }],
          },
        ],
      }),
    );
    const { fetchImpl } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          {
            id: "s-1",
            name: "showcase-ag2",
            image: "ghcr.io/copilotkit/showcase-ag2:latest",
            domain: "showcase-ag2.up.railway.app",
          },
          {
            id: "s-2",
            name: "showcase-langgraph-python",
            image: "ghcr.io/copilotkit/showcase-langgraph-python:latest",
            domain: "showcase-langgraph-python.up.railway.app",
          },
        ]),
      },
      { status: 200, body: { data: { variables: {} } } },
      { status: 200, body: { data: { variables: {} } } },
    ]);
    const env = { ...BASE_ENV, REGISTRY_JSON_PATH: registryPath };
    const out = await railwayServicesSource.enumerate(
      makeCtx(fetchImpl, env),
      {},
    );
    expect(out).toHaveLength(2);
    const byName = Object.fromEntries(out.map((r) => [r.name, r.demos]));
    expect(byName["showcase-ag2"]).toEqual([
      "agentic-chat",
      "human-in-the-loop",
      "tool-based-generative-ui",
    ]);
    expect(byName["showcase-langgraph-python"]).toEqual(["agentic-chat"]);
  });

  it("emits demos: [] for services whose slug is missing from the registry", async () => {
    // Slug derived from `showcase-` prefix strip — `showcase-ag2` →
    // `ag2`. A service whose slug is not in the registry must still be
    // enumerated, but with `demos: []` so the invoker's sort treats it
    // as "no demos" rather than poisoning the tick.
    const registryPath = await writeRegistry(
      JSON.stringify({
        integrations: [
          { slug: "ag2", demos: [{ id: "agentic-chat" }] },
        ],
      }),
    );
    const { fetchImpl } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          {
            id: "s-1",
            name: "showcase-ag2",
            image: "ghcr.io/copilotkit/showcase-ag2:latest",
            domain: "showcase-ag2.up.railway.app",
          },
          {
            id: "s-2",
            name: "showcase-mystery",
            image: "ghcr.io/copilotkit/showcase-mystery:latest",
            domain: "showcase-mystery.up.railway.app",
          },
        ]),
      },
      { status: 200, body: { data: { variables: {} } } },
      { status: 200, body: { data: { variables: {} } } },
    ]);
    const env = { ...BASE_ENV, REGISTRY_JSON_PATH: registryPath };
    const out = await railwayServicesSource.enumerate(
      makeCtx(fetchImpl, env),
      {},
    );
    expect(out).toHaveLength(2);
    const byName = Object.fromEntries(out.map((r) => [r.name, r.demos]));
    expect(byName["showcase-ag2"]).toEqual(["agentic-chat"]);
    expect(byName["showcase-mystery"]).toEqual([]);
  });

  it("logs a warn and emits demos: [] for every service when the registry is unreadable", async () => {
    // Unreadable registry MUST NOT throw — sibling probes still need
    // their service list. The source logs
    // `discovery.railway-services.registry-read-failed` once and emits
    // `demos: []` for every record.
    const warn = vi.fn();
    const ctxLogger = { ...logger, warn };
    const { fetchImpl } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          {
            id: "s-1",
            name: "showcase-ag2",
            image: "ghcr.io/copilotkit/showcase-ag2:latest",
            domain: "showcase-ag2.up.railway.app",
          },
        ]),
      },
      { status: 200, body: { data: { variables: {} } } },
    ]);
    const missingPath = path.join(
      os.tmpdir(),
      `does-not-exist-${Date.now()}-${Math.random()}.json`,
    );
    const env = { ...BASE_ENV, REGISTRY_JSON_PATH: missingPath };
    const out = await railwayServicesSource.enumerate(
      { fetchImpl, logger: ctxLogger, env },
      {},
    );
    expect(out).toHaveLength(1);
    expect(out[0].demos).toEqual([]);
    const readFailed = warn.mock.calls.filter(
      (c) => c[0] === "discovery.railway-services.registry-read-failed",
    );
    expect(readFailed).toHaveLength(1);
  });

  it("honours REGISTRY_JSON_PATH env override over the /app/data default", async () => {
    // Env override is the test/dev hook — production reads
    // /app/data/registry.json (mounted by the Dockerfile). When the env
    // var is set the source MUST read that path verbatim.
    const registryPath = await writeRegistry(
      JSON.stringify({
        integrations: [
          {
            slug: "ag2",
            demos: [{ id: "demo-from-override" }],
          },
        ],
      }),
    );
    const { fetchImpl } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          {
            id: "s-1",
            name: "showcase-ag2",
            image: "ghcr.io/copilotkit/showcase-ag2:latest",
            domain: "showcase-ag2.up.railway.app",
          },
        ]),
      },
      { status: 200, body: { data: { variables: {} } } },
    ]);
    const env = { ...BASE_ENV, REGISTRY_JSON_PATH: registryPath };
    const out = await railwayServicesSource.enumerate(
      makeCtx(fetchImpl, env),
      {},
    );
    expect(out[0].demos).toEqual(["demo-from-override"]);
  });

  it("honours ctx.abortSignal during loadDemosMap and degrades to demos: [] when aborted (A2)", async () => {
    // Discovery context can carry an abortSignal that fires when the
    // probe-invoker's `timeout_ms` elapses. `fs.readFile` previously
    // ignored it, so a stalled volume mount could orphan past the
    // tick. After A2 readFile honours the signal — pre-aborted reads
    // reject with AbortError, the warn fires, and we degrade to an
    // empty demos map (NOT an exception that aborts the whole tick).
    const registryPath = await writeRegistry(
      JSON.stringify({
        integrations: [
          { slug: "ag2", demos: [{ id: "agentic-chat" }] },
        ],
      }),
    );
    const { fetchImpl } = makeFetch([
      {
        status: 200,
        body: railwayProjectResponse([
          {
            id: "s-1",
            name: "showcase-ag2",
            image: "ghcr.io/copilotkit/showcase-ag2:latest",
            domain: "showcase-ag2.up.railway.app",
          },
        ]),
      },
      { status: 200, body: { data: { variables: {} } } },
    ]);

    // Pre-aborted signal — readFile sees a fired signal at call time
    // and rejects synchronously with AbortError. Mimics the case
    // where the per-tick timer fired while another phase was still
    // resolving.
    const abortCtrl = new AbortController();
    abortCtrl.abort(new Error("simulated tick timeout"));

    const warn = vi.fn();
    const ctxLogger = { ...logger, warn };
    const env = { ...BASE_ENV, REGISTRY_JSON_PATH: registryPath };
    const ctx: DiscoveryContext = {
      fetchImpl,
      logger: ctxLogger,
      env,
      abortSignal: abortCtrl.signal,
    };
    // The aborted signal is also what the GraphQL fetch sees, so the
    // overall enumerate() either:
    //   (a) completes with `demos: []` and a warn from the registry
    //       read failure; OR
    //   (b) throws because the GraphQL call rejected with AbortError.
    // Both branches confirm the readFile honours the signal — we
    // assert via the warn-was-called path which is the load-bearing
    // contract for A2 (registry-read-failed with empty map).
    let outOrError: unknown;
    try {
      outOrError = await railwayServicesSource.enumerate(ctx, {});
    } catch (err) {
      outOrError = err;
    }

    // Either way, the readFile MUST have observed the abort and
    // logged the registry-read-failed warn. That's the
    // observable-contract assertion for A2.
    const readFailed = warn.mock.calls.filter(
      (c) => c[0] === "discovery.railway-services.registry-read-failed",
    );
    expect(readFailed).toHaveLength(1);
    // Should mention the abort in the err string.
    const meta = readFailed[0][1] as { err?: string };
    expect(meta.err).toBeTruthy();

    // If enumerate() returned (i.e. the GraphQL fetch wasn't aborted
    // — happens because makeFetch ignores AbortSignal), every record
    // MUST have demos: [] since the registry read collapsed.
    if (Array.isArray(outOrError)) {
      for (const record of outOrError) {
        expect(record.demos).toEqual([]);
      }
    }
  });
});
