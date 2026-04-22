import { describe, it, expect, vi } from "vitest";
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
    const parsed = railwayServicesSource.configSchema.safeParse({
      filter: { namePrefix: "showcase-", labels: { env: "prod" } },
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
      filter: { namePrefix: "showcase-" },
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
      filter: {
        namePrefix: "showcase-",
        nameExcludes: ["showcase-aimock"],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("showcase-langgraph-python");
    expect(calls).toHaveLength(2);
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
      filter: { namePrefix: "showcase-" },
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
});
