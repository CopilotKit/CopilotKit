/**
 * `handleDemoRequest` is the single funnel every route in this app goes
 * through, so three things are asserted here:
 *
 *  1. the in-process request scope is open around the handler — the scope is
 *     what carries the inbound `x-*` headers onto an in-process agent's
 *     outbound LLM call, and without it every built-in-agent aimock fixture
 *     misses and the cell goes red looking like a model problem;
 *  2. every failure arm answers with the `{error, message}` JSON shape and a
 *     message that NAMES the offending thing — these are the only paths that
 *     turn a misconfiguration into a diagnosis;
 *  3. the resolved options actually REACH `CopilotRuntime`. The rest of the
 *     suite proves they are computed correctly; nothing else proves they are
 *     delivered.
 *
 * The runtime and the handler factory are mocked: this file asserts the
 * WIRING, not CopilotKit.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The page tree, relative to THIS file. A page directory's name IS the `agent`
 * prop its page mounts, which is what makes the directory listing a usable
 * source of truth for the ids the runtime must register.
 */
const PAGES_DIR = "../app/[integration]/demos";

const { createCopilotRuntimeHandler, runtimeOptionsSeen, runtimeThrows } =
  vi.hoisted(() => ({
    createCopilotRuntimeHandler: vi.fn(),
    runtimeOptionsSeen: [] as Record<string, unknown>[],
    /**
     * When `message` is set, the stub constructor throws it — standing in for a
     * real CopilotRuntime validator rejecting a manifest value. `demos[].runtime`
     * is an unfiltered pass-through and `RESERVED_RUNTIME_KEYS` blocks only four
     * names, so this is reachable from a manifest and cannot be produced any
     * other way with the constructor mocked.
     */
    runtimeThrows: { message: null as string | null },
  }));

// Partial mock: the handler factory is replaced, and `CopilotRuntime` becomes
// a constructor that records what it was handed. Everything else (BuiltInAgent,
// the adapters, ...) stays real, so in-process agents are built for real.
vi.mock("@copilotkit/runtime/v2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@copilotkit/runtime/v2")>()),
  createCopilotRuntimeHandler,
  CopilotRuntime: class {
    constructor(options: Record<string, unknown>) {
      runtimeOptionsSeen.push(options);
      if (runtimeThrows.message !== null) {
        throw new Error(runtimeThrows.message);
      }
    }
  },
}));

/**
 * `getInProcessAgentFactory` passes through to the real registry unless a
 * test overrides it. Only two arms are unreachable otherwise: built-in-agent
 * is the ONLY in-process integration and it always has a factory, so
 * "declared in-process with no factory" and "the factory threw" cannot be
 * produced from the real manifests.
 */
const inProcess = vi.hoisted(() => ({
  real: undefined as unknown as (
    slug: string,
  ) => ((args: unknown) => unknown) | undefined,
  fn: vi.fn(),
}));

vi.mock("@/lib/in-process-agents", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/in-process-agents")>();
  inProcess.real = actual.getInProcessAgentFactory as never;
  return { ...actual, getInProcessAgentFactory: inProcess.fn };
});

/**
 * Same trick for resolution. No real manifest carries an unresolved
 * placeholder, a reserved runtime key, or agent config on an http
 * integration — validation of those arms would be untestable otherwise.
 */
const resolution = vi.hoisted(() => ({
  // The `manifests` parameter is why this signature is spelled out: the drift
  // arm is asserted against a SYNTHETIC manifest, not against a real one.
  real: undefined as unknown as (
    slug: string,
    demoId: string,
    env?: Record<string, string | undefined>,
    manifests?: readonly AgentIntegrationManifest[],
  ) => Record<string, unknown>,
  fn: vi.fn(),
}));

vi.mock("@/lib/agent-resolution", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/agent-resolution")>();
  resolution.real = actual.resolveDemoRequest as never;
  return { ...actual, resolveDemoRequest: resolution.fn };
});

import {
  HANDLER_CACHE_MAX,
  handleDemoRequest,
  handlerCacheSizeForTests,
  resetDemoRuntimeState,
} from "./demo-runtime";
import type { RuntimeHooks } from "./demo-runtime";
import type {
  AgentIntegrationManifest,
  ResolvedDemo,
} from "./agent-resolution";
import {
  integrationAgentUrlEnvVar,
  ManifestCycleError,
} from "./agent-resolution";
import {
  INTEGRATIONS_DIR_ENV,
  listIntegrations,
  resolveDemoSupport,
} from "./integration-support";
import { DEMO_AUTH_HEADER } from "./demo-auth-token";
import { hasSyntheticReasoning } from "./reasoning-shim";
import { GET as authRouteGET } from "@/app/api/[integration]/auth/[[...slug]]/route";
import { GET as genericRouteGET } from "@/app/api/[integration]/[demo]/[[...slug]]/route";
import { GET as voiceRouteGET } from "@/app/api/[integration]/voice/[[...slug]]/route";
import { forwardingFetch } from "./built-in-agent/header-forwarding";

/**
 * Stand in for the real runtime handler. It calls `forwardingFetch` exactly
 * where an in-process agent would, so the captured outbound headers report
 * whether the scope was open around it.
 */
function handlerThatCallsOutbound(): () => Headers {
  const fetchSpy = vi.fn<typeof fetch>(async () => new Response(null));
  vi.stubGlobal("fetch", fetchSpy);
  vi.spyOn(console, "log").mockImplementation(() => {});
  createCopilotRuntimeHandler.mockReturnValue(async () => {
    await forwardingFetch("https://example.test/v1/responses", {
      method: "POST",
    });
    return new Response("ok");
  });
  return () => new Headers(fetchSpy.mock.calls[0]?.[1]?.headers);
}

function requestWithContext(context: string): Request {
  return new Request("https://showcase.test/api/x/y", {
    method: "POST",
    headers: { "x-aimock-context": context },
  });
}

function plainRequest(): Request {
  return new Request("https://showcase.test/api/x/y", { method: "POST" });
}

/**
 * Serve one request. Failure arms answer JSON; the success arm answers
 * whatever the stubbed handler returned, so the body is parsed leniently.
 */
async function serve(
  slug: string,
  demoId: string,
): Promise<{ status: number; body: { error?: string; message?: string } }> {
  const response = await handleDemoRequest(plainRequest(), {
    routeId: "generic",
    slug,
    demoId,
    basePath: `/api/${slug}/${demoId}`,
    mode: "single-route",
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: {} };
  }
}

/**
 * A synthetic manifest with deliberate drift: `orphan-demo` is under
 * `features` with no `demos[]` entry. Injected through `resolveDemoRequest`'s
 * `manifests` parameter, so no real manifest has to stay broken for the drift
 * arm to have a test.
 */
const SYNTHETIC_DRIFT: AgentIntegrationManifest = {
  name: "Synthetic",
  slug: "synthetic",
  features: ["orphan-demo"],
  demos: [],
};

/** A resolution with every field set, for the arms no manifest can produce. */
function craftResolution(overrides: Partial<ResolvedDemo>): void {
  const resolved: ResolvedDemo = {
    demoId: "agentic-chat",
    manifest: { name: "Strands", slug: "strands" },
    demo: { id: "agentic-chat", name: "Agentic Chat" },
    agentName: "agentic-chat",
    target: { kind: "http", url: "http://strands:8000/" },
    agentConfig: {},
    runtimeOptions: {},
    injectSyntheticReasoning: false,
    unresolvedPlaceholders: [],
    ...overrides,
  };
  resolution.fn.mockReturnValue({ ok: true, resolved });
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetDemoRuntimeState();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  runtimeOptionsSeen.length = 0;
  runtimeThrows.message = null;
  createCopilotRuntimeHandler.mockReset();
  createCopilotRuntimeHandler.mockReturnValue(async () => new Response("ok"));
  inProcess.fn.mockReset();
  inProcess.fn.mockImplementation((slug: string) => inProcess.real(slug));
  resolution.fn.mockReset();
  resolution.fn.mockImplementation((slug: string, demoId: string) =>
    resolution.real(slug, demoId),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("handleDemoRequest in-process request scope", () => {
  it("opens the scope for an in-process integration, so x-* headers reach the LLM call", async () => {
    const outbound = handlerThatCallsOutbound();

    const response = await handleDemoRequest(
      requestWithContext("built-in-agent/chat-customization-css"),
      {
        routeId: "generic",
        slug: "built-in-agent",
        demoId: "chat-customization-css",
        basePath: "/api/built-in-agent/chat-customization-css",
        mode: "single-route",
      },
    );

    expect(response.status).toBe(200);
    expect(outbound().get("x-aimock-context")).toBe(
      "built-in-agent/chat-customization-css",
    );
  });

  it("is a pass-through for a slug with no in-process agent", async () => {
    // The wrap is unconditional, so this asserts the no-op half of it: an
    // HTTP integration still serves, and nothing is forwarded.
    const outbound = handlerThatCallsOutbound();
    // Without a base URL the route 404s before the handler is ever built.
    vi.stubEnv("AGENT_URL_LANGGRAPH_PYTHON", "http://langgraph-python:8123");

    const response = await handleDemoRequest(
      requestWithContext("langgraph-python/agentic-chat"),
      {
        routeId: "generic",
        slug: "langgraph-python",
        demoId: "agentic-chat",
        basePath: "/api/langgraph-python/agentic-chat",
        mode: "single-route",
      },
    );

    expect(response.status).toBe(200);
    expect(outbound().get("x-aimock-context")).toBeNull();
  });
});

describe("handleDemoRequest failure arms", () => {
  it("404s an unknown integration, naming it", async () => {
    const { status, body } = await serve("no-such-integration", "agentic-chat");
    expect(status).toBe(404);
    expect(body.error).toBe("not_found");
    expect(body.message).toContain("no-such-integration");
  });

  it("404s a demo the integration declares unsupported, naming both", async () => {
    const { status, body } = await serve("agno", "gen-ui-interrupt");
    expect(status).toBe(404);
    expect(body.error).toBe("not_supported");
    expect(body.message).toContain("Agno");
  });

  it("404s manifest drift — supported, but no demos[] entry — naming the demo", async () => {
    // A SYNTHETIC manifest, not a real one. The drift message tells the author
    // to add the missing demos[] entry, so pinning this to live drift would
    // turn the test red the moment someone takes that advice.
    resolution.fn.mockReturnValue(
      resolution.real("synthetic", "orphan-demo", {}, [SYNTHETIC_DRIFT]),
    );

    const { status, body } = await serve("synthetic", "orphan-demo");
    expect(status).toBe(404);
    // `not_supported`, not `not_found`: drift is now caught by
    // `resolveDemoSupport` — the ONE authority the page tree also asks — so the
    // rendered cell and this API answer can no longer disagree. The diagnosis
    // is unchanged, which is what the message assertions below pin.
    expect(body.error).toBe("not_supported");
    expect(body.message).toMatch(/Manifest drift/);
    expect(body.message).toContain("orphan-demo");
    expect(body.message).toContain("synthetic");
  });

  it("404s an informational demo instead of giving it agent advice", async () => {
    // `cli-start` is a copy-paste `npx copilotkit@latest init …` cell: no
    // route, no agent, no backend. It used to reach the LangGraph arm and
    // answer "add demos[].agent.graph", which is nonsense for a command.
    vi.stubEnv("AGENT_URL_LANGGRAPH_PYTHON", "http://langgraph-python:8123");
    const { status, body } = await serve("langgraph-python", "cli-start");
    expect(status).toBe(404);
    // `informational`, not `not_found` and not `not_supported`. The pair is
    // caught by `resolveDemoSupport` — the one authority both the page tree and
    // this route ask — before resolution runs, and it gets its own error code
    // because the integration DOES support the feature; the feature just has no
    // runnable surface. Calling it "not supported" here would reintroduce the
    // false claim the index page was making.
    expect(body.error).toBe("informational");
    expect(body.message).toContain("cli-start");
    expect(body.message).toContain("informational");
    expect(body.message).not.toContain("agent.graph");
  });

  it("404s with the missing env var by name when no agent URL is set", async () => {
    // The whole value of this arm is the variable name. A refactor that
    // drops it leaves an operator with "unconfigured" and nothing to set.
    const { status, body } = await serve("langgraph-python", "agentic-chat");
    expect(status).toBe(404);
    expect(body.error).toBe("unconfigured");
    expect(body.message).toContain("AGENT_URL_LANGGRAPH_PYTHON");
  });

  it("500s a langgraph demo with no agent.graph, naming the demo and the field", async () => {
    // A crafted resolution, not `cli-start`: that demo is informational and
    // 404s earlier now, and using it here made this test depend on a product
    // bug rather than on the rule it means to pin.
    craftResolution({
      demoId: "no-graph",
      target: { kind: "langgraph", deploymentUrl: "http://lg:8123" },
    });
    const { status, body } = await serve("strands", "no-graph");
    expect(status).toBe(500);
    expect(body.error).toBe("misconfigured");
    expect(body.message).toContain("no-graph");
    expect(body.message).toContain("agent.graph");
  });

  it("501s an in-process integration this app carries no factory for", async () => {
    inProcess.fn.mockReturnValue(undefined);
    const { status, body } = await serve("built-in-agent", "agentic-chat");
    expect(status).toBe(501);
    expect(body.error).toBe("not_implemented");
    expect(body.message).toContain("built-in-agent");
    expect(body.message).toContain("in-process-agents.ts");
  });

  it("500s as JSON when the in-process factory throws, keeping its message", async () => {
    // The factory throws BY DESIGN on manifest/registry drift, and that
    // message is the whole diagnosis. Uncaught it becomes Next's generic
    // 500 HTML and the caller sees neither the message nor the JSON shape.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    inProcess.fn.mockReturnValue(() => {
      throw new Error("Add it to BUILT_IN_AGENT_BUILDERS in in-process-agents");
    });

    const { status, body } = await serve("built-in-agent", "agentic-chat");
    expect(status).toBe(500);
    expect(body.error).toBe("agent_build_failed");
    expect(body.message).toContain("BUILT_IN_AGENT_BUILDERS");
    expect(error).toHaveBeenCalled();
  });

  it("500s when a bare ${VAR} resolved to nothing, naming the variables", async () => {
    craftResolution({
      unresolvedPlaceholders: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
    });
    const { status, body } = await serve("strands", "agentic-chat");
    expect(status).toBe(500);
    expect(body.error).toBe("misconfigured");
    expect(body.message).toContain("strands/agentic-chat");
    expect(body.message).toContain("OPENAI_API_KEY");
    expect(body.message).toContain("ANTHROPIC_API_KEY");
  });

  it("500s a manifest that sets a reserved CopilotRuntime option", async () => {
    // `demos[].runtime` is an unfiltered pass-through, and that has a sharp
    // edge: `agents` would replace the agent map that was just built, and
    // `channels` throws inside the runtime constructor.
    craftResolution({ runtimeOptions: { channels: [], agents: {} } });
    const { status, body } = await serve("strands", "agentic-chat");
    expect(status).toBe(500);
    expect(body.error).toBe("misconfigured");
    expect(body.message).toContain("agents");
    expect(body.message).toContain("channels");
    expect(runtimeOptionsSeen).toEqual([]);
  });

  it("500s agent config on a kind that cannot carry it, rather than dropping it", async () => {
    // Only LangGraph has somewhere to put agent-construction options
    // (assistantConfig). Dropping them silently is the exact loss the
    // runtime / agent-config split exists to prevent.
    craftResolution({ agentConfig: { recursion_limit: 25 } });
    const { status, body } = await serve("strands", "agentic-chat");
    expect(status).toBe(500);
    expect(body.error).toBe("misconfigured");
    expect(body.message).toContain("recursion_limit");
  });

  it("500s the reasoning shim on a kind that cannot carry it, rather than dropping it", async () => {
    // The shim wraps an http AG-UI agent. Listed against a langgraph or
    // in-process integration it would be dropped in silence, and the symptom is
    // a cell that renders perfectly and never shows a reasoning bubble.
    craftResolution({
      demoId: "reasoning-default",
      injectSyntheticReasoning: true,
      target: {
        kind: "langgraph",
        deploymentUrl: "http://lg:8123",
        graphId: "g",
      },
    });

    const { status, body } = await serve("strands", "reasoning-default");
    expect(status).toBe(500);
    expect(body.error).toBe("misconfigured");
    expect(body.message).toContain("synthetic_reasoning_demos");
    expect(body.message).toContain("reasoning-default");
  });

  it("accepts agent config on the langgraph kind", async () => {
    craftResolution({
      agentConfig: { recursion_limit: 25 },
      target: {
        kind: "langgraph",
        deploymentUrl: "http://lg:8123",
        graphId: "g",
      },
    });
    const { status } = await serve("strands", "agentic-chat");
    expect(status).toBe(200);
  });
});

describe("runtime and handler construction failures", () => {
  /**
   * The construction between `resolveDemoRequest` and the serve call used to be
   * the only unguarded step in the request path, and the most likely to throw:
   * `demos[].runtime` is a deliberate unfiltered pass-through, so any manifest
   * value a CopilotRuntime validator rejects lands here.
   *
   * The second-order effect is the real damage, and it is what the caching
   * assertions below are about: `createCopilotRuntimeHandler` fires
   * `fireInstanceCreatedTelemetry` on its FIRST line, so a throw after that
   * point with no cache entry re-fires the event on every retry — the flood the
   * memoisation exists to prevent, reached by the error path.
   */
  function silenceErrors(): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(console, "error").mockImplementation(() => {});
  }

  it("500s as JSON when the runtime constructor throws, keeping its message", async () => {
    const error = silenceErrors();
    runtimeThrows.message = "mcpApps.servers[0] is missing a url";
    craftResolution({});

    const { status, body } = await serve("strands", "agentic-chat");
    expect(status).toBe(500);
    expect(body.error).toBe("runtime_build_failed");
    expect(body.message).toContain("mcpApps.servers[0]");
    expect(error).toHaveBeenCalled();
  });

  it("does not re-enter construction after a runtime failure, so telemetry cannot re-fire", async () => {
    silenceErrors();
    runtimeThrows.message = "bad a2ui shape";
    craftResolution({});

    const first = await serve("strands", "agentic-chat");
    const second = await serve("strands", "agentic-chat");
    const third = await serve("strands", "agentic-chat");

    // Constructed ONCE across three requests, and every answer still carries
    // the message — the cached value is the message, never the `Response`,
    // whose body can be read only once.
    expect(runtimeOptionsSeen).toHaveLength(1);
    for (const answer of [first, second, third]) {
      expect(answer.status).toBe(500);
      expect(answer.body.message).toContain("bad a2ui shape");
    }
  });

  it("500s, and stops re-firing telemetry, when the handler FACTORY throws", async () => {
    // The sharp case: the factory fires the telemetry event before it can
    // throw, so an uncached failure here is one outbound event per request.
    const error = silenceErrors();
    createCopilotRuntimeHandler.mockImplementation(() => {
      throw new Error("handler factory refused the runtime");
    });
    craftResolution({});

    const first = await serve("strands", "agentic-chat");
    await serve("strands", "agentic-chat");
    await serve("strands", "agentic-chat");

    expect(first.status).toBe(500);
    expect(first.body.error).toBe("runtime_build_failed");
    expect(first.body.message).toContain("handler factory refused");
    expect(createCopilotRuntimeHandler).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
  });

  it("rebuilds on a DIFFERENT key, so a cached failure never poisons another demo", async () => {
    silenceErrors();
    runtimeThrows.message = "bad a2ui shape";
    craftResolution({ demoId: "broken", agentName: "broken" });
    expect((await serve("strands", "broken")).status).toBe(500);

    runtimeThrows.message = null;
    craftResolution({ demoId: "fine", agentName: "fine" });
    expect((await serve("strands", "fine")).status).toBe(200);
  });

  it("500s as JSON when SERVING rejects, rather than returning Next's HTML", async () => {
    // `withInProcessRequestScope` wraps the handler, so a rejection out of
    // either is a rejected promise out of the route handler. This is the last
    // frame that can still answer in the `{error, message}` shape.
    const error = silenceErrors();
    createCopilotRuntimeHandler.mockReturnValue(async () => {
      throw new Error("upstream socket hung up");
    });
    craftResolution({});

    const { status, body } = await serve("strands", "agentic-chat");
    expect(status).toBe(500);
    expect(body.error).toBe("request_failed");
    expect(body.message).toContain("socket hung up");
    expect(error).toHaveBeenCalled();
  });

  it("does NOT cache a serve failure — one rejection says nothing about the next", async () => {
    silenceErrors();
    let calls = 0;
    createCopilotRuntimeHandler.mockReturnValue(async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return new Response("ok");
    });
    craftResolution({});

    expect((await serve("strands", "agentic-chat")).status).toBe(500);
    expect((await serve("strands", "agentic-chat")).status).toBe(200);
  });
});

describe("manifest load failure", () => {
  it("answers JSON with the operator-facing message, not Next's HTML 500", async () => {
    // The single likeliest deployment misconfiguration: an unset or wrong
    // SHOWCASE_INTEGRATIONS_DIR, malformed YAML, or an image that staged
    // nothing. `ManifestLoadError`'s message was written for an operator to
    // read, and resolution runs before the agent-build try/catch, so this arm
    // used to hand back an HTML page — unparseable to the D6 probes.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv(INTEGRATIONS_DIR_ENV, "F:/definitely/not/a/manifest/tree");

    const { status, body } = await serve("agno", "subagents");

    expect(status).toBe(500);
    expect(body.error).toBe("manifest_load_failed");
    expect(body.message).toContain(INTEGRATIONS_DIR_ENV);
    expect(body.message).toContain("not/a/manifest/tree");
    expect(error).toHaveBeenCalled();
  });

  it("gives a self-referencing manifest value its OWN code, not manifest_load_failed", async () => {
    // The file loaded and parsed fine; a YAML alias made a value its own
    // ancestor. Reporting that as a load failure sends the reader to
    // SHOWCASE_INTEGRATIONS_DIR and the YAML syntax, neither of which is wrong.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    resolution.fn.mockImplementation(() => {
      throw new ManifestCycleError("<root>.mcpApps.servers[0]");
    });

    const { status, body } = await serve("agno", "mcp-apps");

    expect(status).toBe(500);
    expect(body.error).toBe("manifest_cycle");
    expect(body.message).toContain("<root>.mcpApps.servers[0]");
    expect(body.message).toContain("anchor");
    expect(error).toHaveBeenCalled();
  });
});

/**
 * THE PROTOCOL PAIRING. Read `RuntimeMode` in `demo-runtime.ts` first.
 *
 * A page's provider and its route's handler must speak the same wire protocol,
 * and NOTHING negotiates between them. Every demo page mounts `<CopilotKit>`
 * from `@copilotkit/react-core/v2`, which is the V1 COMPATIBILITY WRAPPER
 * (`packages/react-core/src/v2/index.ts` re-exports
 * `components/copilot-provider/copilotkit`), not the V2 provider — it applies
 * `useSingleEndpoint={props.useSingleEndpoint ?? true}`. So:
 *
 *   page sets nothing                -> single-endpoint transport
 *   page sets useSingleEndpoint=false -> REST sub-path transport
 *
 * A mismatch is SILENT: `matchRoute` cannot match a bare base path, so a
 * single-endpoint client aimed at a multi-route handler gets
 * `404 {"error":"Not found"}`, nothing is logged, and the chat renders empty.
 * Every demo in this app 404'd that way once, and unit tests did not catch it
 * because nothing tied the server's mode to the pages' transport. These tests
 * are that tie. They read the PAGES ON DISK, so a new page that opts out
 * without a matching multi-route sibling goes red instead of 404ing in
 * production.
 */
describe("invariant: server mode matches the pages' transport", () => {
  const DEMOS_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    PAGES_DIR,
  );
  const API_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../app/api/[integration]",
  );

  /**
   * Demo ids whose page opts OUT of the single-endpoint default. Derived from
   * the page source, never from a hand-kept list — a hand-kept list is what
   * rots the moment a third page opts out.
   */
  function demosOptingOutOfSingleEndpoint(): string[] {
    return readdirSync(DEMOS_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .filter((entry) => {
        const page = path.join(DEMOS_ROOT, entry.name, "page.tsx");
        let source: string;
        try {
          source = readFileSync(page, "utf8");
        } catch {
          return false;
        }
        // Matches `useSingleEndpoint={false}` with any inner whitespace. A page
        // that passes a VARIABLE (`useSingleEndpoint={x}`) is deliberately not
        // matched: the value is then unknowable from disk, and the assertion
        // below would silently weaken. Such a page should be written as a
        // literal or this test updated to fail loudly on it.
        return /useSingleEndpoint=\{\s*false\s*\}/.test(source);
      })
      .map((entry) => entry.name)
      .sort();
  }

  /** Demo ids that have their own route file under `api/[integration]/`. */
  function siblingRouteDemos(): string[] {
    return readdirSync(API_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "[demo]")
      .map((entry) => entry.name)
      .sort();
  }

  /** The `mode` a route actually handed the handler factory. */
  async function modePassedBy(
    invoke: () => Promise<Response>,
  ): Promise<string | undefined> {
    inProcess.fn.mockReturnValue(() => ({}));
    const response = await invoke();
    expect(response.status).toBe(200);
    const options = createCopilotRuntimeHandler.mock.calls[0]?.[0] as {
      mode?: string;
    };
    return options.mode;
  }

  it("serves the generic route single-route, matching the 45+ pages that do not opt out", async () => {
    // `agentic-chat` is representative: it sets no `useSingleEndpoint`, so its
    // client POSTs the envelope to the base path and NOTHING else.
    const mode = await modePassedBy(() =>
      genericRouteGET(plainRequest(), {
        params: Promise.resolve({
          integration: "built-in-agent",
          demo: "agentic-chat",
        }),
      }),
    );
    expect(mode).toBe("single-route");
  });

  it("serves the auth route multi-route, because its page opts out", async () => {
    expect(demosOptingOutOfSingleEndpoint()).toContain("auth");
    const mode = await modePassedBy(() =>
      authRouteGET(plainRequest(), {
        params: Promise.resolve({ integration: "built-in-agent" }),
      }),
    );
    expect(mode).toBe("multi-route");
  });

  it("serves the voice route multi-route, because its page opts out", async () => {
    expect(demosOptingOutOfSingleEndpoint()).toContain("voice");
    const mode = await modePassedBy(() =>
      voiceRouteGET(plainRequest(), {
        params: Promise.resolve({ integration: "built-in-agent" }),
      }),
    );
    expect(mode).toBe("multi-route");
  });

  it("gives every opting-out page its own multi-route sibling, and no others", () => {
    // THE ANTI-ROT ASSERTION, and the one that would have caught the original
    // defect from the other direction.
    //
    // A page that sets `useSingleEndpoint={false}` needs REST sub-paths, which
    // only a multi-route handler serves. The generic route is single-route, so
    // such a page MUST be served by its own sibling route file that passes
    // `mode: "multi-route"`.
    //
    // Fails if: a new page opts out but keeps being served by the generic
    // single-route handler (it would 404 silently in production), or a sibling
    // route exists for a page that does NOT opt out (its handler would speak a
    // protocol its page does not).
    //
    // A genuinely new sibling route must also get an explicit mode assertion
    // above; this equality alone does not check a third sibling's mode.
    expect(demosOptingOutOfSingleEndpoint()).toEqual(siblingRouteDemos());
  });
});

describe("the auth route's bearer gate", () => {
  /**
   * The ONLY authentication in this app, and it lives in `hooks.onRequest` —
   * code, which no manifest can carry. Two things are asserted: the hooks
   * REACH the handler factory (a refactor that drops the `hooks` argument
   * silently removes authentication), and the gate itself accepts exactly one
   * header value.
   */
  async function captureAuthHooks(): Promise<RuntimeHooks> {
    // Stub the in-process factory so any demo builds; the gate is what is
    // under test, not the agent.
    inProcess.fn.mockReturnValue(() => ({}));

    const response = await authRouteGET(plainRequest(), {
      params: Promise.resolve({ integration: "built-in-agent" }),
    });
    expect(response.status).toBe(200);

    const options = createCopilotRuntimeHandler.mock.calls[0]?.[0] as {
      hooks?: RuntimeHooks;
      basePath?: string;
    };
    expect(options.basePath).toBe("/api/built-in-agent/auth");
    expect(options.hooks).toBeDefined();
    return options.hooks as RuntimeHooks;
  }

  it("hands its hooks to createCopilotRuntimeHandler", async () => {
    const hooks = await captureAuthHooks();
    expect(createCopilotRuntimeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ hooks }),
    );
    expect(typeof hooks?.onRequest).toBe("function");
  });

  it("rejects a missing Authorization header with a 401 JSON body", async () => {
    const hooks = await captureAuthHooks();
    const thrown = await captureThrow(hooks, new Request("https://x.test/"));
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(401);
    expect(await (thrown as Response).json()).toMatchObject({
      error: "unauthorized",
    });
  });

  it("rejects a WRONG Authorization header", async () => {
    const hooks = await captureAuthHooks();
    const thrown = await captureThrow(
      hooks,
      new Request("https://x.test/", {
        headers: { authorization: "Bearer not-the-demo-token" },
      }),
    );
    expect((thrown as Response).status).toBe(401);
  });

  it("lets the exact demo header through", async () => {
    const hooks = await captureAuthHooks();
    const thrown = await captureThrow(
      hooks,
      new Request("https://x.test/", {
        headers: { authorization: DEMO_AUTH_HEADER },
      }),
    );
    expect(thrown).toBeUndefined();
  });
});

/** Run `onRequest` and return whatever it threw, or `undefined`. */
async function captureThrow(
  hooks: RuntimeHooks,
  request: Request,
): Promise<unknown> {
  try {
    await hooks?.onRequest?.({ request } as never);
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("the generic route refuses ids its siblings own", () => {
  it.each(["auth", "voice"])(
    "404s demo %s rather than serving it without that route's code",
    async (demo) => {
      // Next.js prefers the static sibling segments, but that preference is
      // configuration. If any path form reaches `[demo]` with a decoded param
      // of `auth`, serving it here means serving the auth demo WITHOUT the
      // bearer gate.
      const response = await genericRouteGET(plainRequest(), {
        params: Promise.resolve({ integration: "built-in-agent", demo }),
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: "not_found" });
      expect(createCopilotRuntimeHandler).not.toHaveBeenCalled();
    },
  );

  it("still serves an ordinary demo", async () => {
    inProcess.fn.mockReturnValue(() => ({}));
    const response = await genericRouteGET(plainRequest(), {
      params: Promise.resolve({
        integration: "built-in-agent",
        demo: "agentic-chat",
      }),
    });
    expect(response.status).toBe(200);
  });
});

describe("LangSmith tracing", () => {
  it("says ONCE that LANGSMITH_API_KEY is absent, instead of silently not tracing", async () => {
    // An empty key is legal — LangGraph runs fine without tracing. The
    // failure it hides is a deployment where traces never appear and
    // nothing ever explains why.
    vi.stubEnv("AGENT_URL_LANGGRAPH_PYTHON", "http://langgraph-python:8123");
    vi.stubEnv("LANGSMITH_API_KEY", "");

    await serve("langgraph-python", "agentic-chat");
    await serve("langgraph-python", "subagents");

    const said = warn.mock.calls.filter((call) =>
      String(call[0]).includes("LANGSMITH_API_KEY"),
    );
    expect(said).toHaveLength(1);
  });

  it("says nothing when the key is set", async () => {
    vi.stubEnv("AGENT_URL_LANGGRAPH_PYTHON", "http://langgraph-python:8123");
    vi.stubEnv("LANGSMITH_API_KEY", "ls-key");

    await serve("langgraph-python", "agentic-chat");

    expect(
      warn.mock.calls.filter((call) =>
        String(call[0]).includes("LANGSMITH_API_KEY"),
      ),
    ).toHaveLength(0);
  });
});

describe("what actually reaches CopilotRuntime", () => {
  it("delivers this demo's resolved runtime options and every agent key", async () => {
    vi.stubEnv("AGENT_URL_AGNO", "http://agno:8000");

    const { status } = await serve("agno", "mcp-apps");
    expect(status).toBe(200);
    expect(runtimeOptionsSeen).toHaveLength(1);

    const options = runtimeOptionsSeen[0];
    expect(options.mcpApps).toEqual({
      servers: [
        {
          type: "http",
          url: "https://mcp.excalidraw.com",
          serverId: "excalidraw",
        },
      ],
    });

    // `mcp-apps` sets no `agent.name`, so the manifest label and the demo id
    // are the same string and the computed keys collapse to two. That
    // COINCIDENCE is why this assertion alone never caught the demo-id bug —
    // see "every page's agent id resolves" below for the case where they
    // differ.
    const agents = options.agents as Record<string, unknown>;
    expect(Object.keys(agents).sort()).toEqual(["default", "mcp-apps"]);
    expect(agents["mcp-apps"]).toBe(agents.default);
  });

  it("langgraph-fastapi a2ui-recovery delivers injectA2UITool: false and the catalog id", async () => {
    vi.stubEnv("AGENT_URL_LANGGRAPH_FASTAPI", "http://langgraph-fastapi:8123");
    const { status } = await serve("langgraph-fastapi", "a2ui-recovery");
    expect(status).toBe(200);
    expect(runtimeOptionsSeen).toHaveLength(1);
    expect(runtimeOptionsSeen[0].a2ui).toEqual({
      injectA2UITool: false,
      defaultCatalogId: "declarative-gen-ui-catalog",
    });
  });

  it("registers the DEMO ID even when the manifest names the agent something else", async () => {
    // The exact shape of the 404: `demos/auth/page.tsx` mounts
    // `<CopilotKit agent="auth">` while ag2's manifest says
    // `agent: { name: auth-demo }`, so the client dials `.../agent/auth/run`.
    // `default` does not rescue it — a client given an `agent` prop never
    // falls back to it.
    craftResolution({ demoId: "auth", agentName: "auth-demo" });

    expect((await serve("strands", "auth")).status).toBe(200);

    const agents = runtimeOptionsSeen[0].agents as Record<string, unknown>;
    expect(Object.keys(agents).sort()).toEqual([
      "auth",
      "auth-demo",
      "default",
    ]);
    // ONE agent instance under all three ids, never three agents.
    expect(agents.auth).toBe(agents.default);
    expect(agents["auth-demo"]).toBe(agents.default);
  });

  /*
   * THE REASONING SHIM IS CONDITIONAL, AND BOTH SIDES OF THE CONDITION MATTER.
   *
   * `ms-agent-dotnet`'s .NET AG-UI host emits no `REASONING_*` events, so its
   * reasoning cells need synthetic ones — that behaviour used to live in the
   * integration's OWN route and is why the cell passed there and failed after
   * migration. `mastra` emits them itself, so applying the shim to it would
   * DOUBLE every reasoning bubble. Same demo id, opposite answer: the signal is
   * the manifest's `synthetic_reasoning_demos`, read through the real manifests
   * on disk here rather than through a crafted resolution.
   */
  it("shims the agent for a slug whose backend cannot emit reasoning events", async () => {
    vi.stubEnv("AGENT_URL_MS_AGENT_DOTNET", "http://ms-agent-dotnet:8000");

    const { status } = await serve("ms-agent-dotnet", "reasoning-default");
    expect(status).toBe(200);

    const agents = runtimeOptionsSeen[0].agents as Record<string, object>;
    expect(hasSyntheticReasoning(agents["reasoning-default"])).toBe(true);
  });

  it("does NOT shim a slug whose backend emits reasoning events itself", async () => {
    vi.stubEnv("AGENT_URL_MASTRA", "http://mastra:8000");

    const { status } = await serve("mastra", "reasoning-default");
    expect(status).toBe(200);

    const agents = runtimeOptionsSeen[0].agents as Record<string, object>;
    expect(hasSyntheticReasoning(agents["reasoning-default"])).toBe(false);
  });

  it("does NOT shim an unlisted demo on a slug that lists others", async () => {
    // The field is per-DEMO for a reason: the same .NET backend serves
    // `tool-rendering-default-catchall`, and injecting reasoning frames into
    // that cell breaks its spec. Integration-wide application would have been
    // the easy mistake.
    vi.stubEnv("AGENT_URL_MS_AGENT_DOTNET", "http://ms-agent-dotnet:8000");

    const { status } = await serve(
      "ms-agent-dotnet",
      "tool-rendering-default-catchall",
    );
    expect(status).toBe(200);

    const agents = runtimeOptionsSeen[0].agents as Record<string, object>;
    expect(
      hasSyntheticReasoning(agents["tool-rendering-default-catchall"]),
    ).toBe(false);
  });

  it("does not leak one demo's flags into the next demo's runtime", async () => {
    vi.stubEnv("AGENT_URL_AGNO", "http://agno:8000");

    await serve("agno", "mcp-apps");
    await serve("agno", "subagents");

    expect(runtimeOptionsSeen).toHaveLength(2);
    expect(runtimeOptionsSeen[0].mcpApps).toBeDefined();
    expect(runtimeOptionsSeen[1].mcpApps).toBeUndefined();
  });

  it("lets runtimeExtras win over manifest options, but never over agents", async () => {
    craftResolution({ runtimeOptions: { openGenerativeUI: true } });

    await handleDemoRequest(plainRequest(), {
      routeId: "generic",
      slug: "strands",
      demoId: "agentic-chat",
      basePath: "/api/strands/agentic-chat",
      mode: "single-route",
      runtimeExtras: {
        openGenerativeUI: false,
        // A route contributes code, not agents. The agent map is built from
        // the resolved target and nothing may replace it.
        agents: { hijacked: {} },
      },
    });

    const options = runtimeOptionsSeen[0];
    expect(options.openGenerativeUI).toBe(false);
    expect(Object.keys(options.agents as object).sort()).toEqual([
      "agentic-chat",
      "default",
    ]);
  });
});

/**
 * THE REGRESSION THIS FILE PREVIOUSLY COULD NOT SEE.
 *
 * The agent map used to be keyed by `resolved.agentName` — the manifest's
 * `demos[].agent.name` — and by `default`. Every ported page mounts
 * `<CopilotKit agent="<demo id>">`, and about 160 (integration, demo) pairs
 * across the real manifests give the agent a name that DIFFERS from the demo id
 * (`auth` / `auth-demo`, `agentic-chat` / `agentic_chat`,
 * `hitl` / `human_in_the_loop`, …). Each of those 404'd on every message:
 * `cloneAgentForRequest` looks the id up strictly, and `default` is not a
 * fallback for a client that was handed an `agent` prop.
 *
 * The one existing agent-key assertion passed throughout, because it used
 * `agno`/`mcp-apps` — a demo that sets no `agent.name`, so its two keys happen
 * to coincide. This suite is data-driven over the REAL manifests instead, so a
 * key that stops being registered fails here no matter which demo carries it.
 */
describe("every page's agent id resolves", () => {
  /** Demo ids that have a page under src/app/[integration]/demos/<id>/. */
  const pageDemoIds = new Set(
    readdirSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), PAGES_DIR),
      { withFileTypes: true },
    )
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name),
  );

  /**
   * Every (integration, demo) pair a page can actually mount: supported by the
   * integration, described in `demos[]`, servable by an agent, and backed by a
   * page whose `agent` prop is the demo id.
   */
  function servablePairsWithPages(): { slug: string; demoId: string }[] {
    const pairs: { slug: string; demoId: string }[] = [];
    for (const manifest of listIntegrations() as AgentIntegrationManifest[]) {
      for (const demo of manifest.demos ?? []) {
        if (!pageDemoIds.has(demo.id)) continue;
        if (resolveDemoSupport(manifest.slug, demo.id).kind !== "supported") {
          continue;
        }
        // Informational cells (`cli-start`) run no agent; `resolveDemoRequest`
        // 404s them by design.
        if (!demo.route && !demo.agent) continue;
        pairs.push({ slug: manifest.slug, demoId: demo.id });
      }
    }
    return pairs;
  }

  /** Point every integration's `AGENT_URL_*` somewhere, so none 404s early. */
  function configureEveryAgentUrl(): void {
    for (const manifest of listIntegrations()) {
      vi.stubEnv(
        integrationAgentUrlEnvVar(manifest.slug),
        `http://${manifest.slug}.test:8000`,
      );
    }
  }

  it("registers each page's demo id in the agent map it is served by", async () => {
    configureEveryAgentUrl();
    // built-in-agent's factories build REAL agents and log; the rest of this
    // suite is about the key set, not about agent construction.
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const pairs = servablePairsWithPages();
    // A floor, so a resolution change that quietly stops producing pairs turns
    // this suite into a vacuous pass. ~700 pairs exist today.
    expect(pairs.length).toBeGreaterThan(500);

    const missingKey: string[] = [];
    const neverBuilt: { pair: string; status: number; error?: string }[] = [];

    for (const { slug, demoId } of pairs) {
      const before = runtimeOptionsSeen.length;
      const { status, body } = await serve(slug, demoId);
      const built = runtimeOptionsSeen.slice(before);
      if (built.length === 0) {
        neverBuilt.push({
          pair: `${slug}/${demoId}`,
          status,
          error: body.error,
        });
        continue;
      }
      const agents = built[0].agents as Record<string, unknown>;
      if (!Object.hasOwn(agents, demoId)) {
        missingKey.push(
          `${slug}/${demoId} -> ${Object.keys(agents).join("|")}`,
        );
      }
    }

    // Every pair must reach a runtime. A pair that does not is either a real
    // misconfiguration or a silent hole in this suite's coverage, and both are
    // worth failing on — listing them by name so the reason is readable.
    expect(neverBuilt).toEqual([]);
    expect(missingKey).toEqual([]);
  });

  it("covers the pairs whose agent name DIFFERS from the demo id", async () => {
    // The subset the old key set broke, asserted to be non-empty. Without this
    // the suite above would still pass if every manifest stopped overriding
    // `agent.name` — and the regression it guards would be untested again.
    const mismatched = servablePairsWithPages().filter(({ slug, demoId }) => {
      const manifest = (listIntegrations() as AgentIntegrationManifest[]).find(
        (entry) => entry.slug === slug,
      );
      const demo = manifest?.demos?.find((entry) => entry.id === demoId);
      return demo?.agent?.name !== undefined && demo.agent.name !== demoId;
    });

    expect(mismatched.length).toBeGreaterThan(100);
  });
});

describe("handler memoisation", () => {
  /**
   * `createCopilotRuntimeHandler` fires `fireInstanceCreatedTelemetry` on its
   * first line, documented as "once per handler factory invocation (not per
   * request)". Building one per request turns every `/info`, `/run` and
   * `/connect` into a telemetry event.
   */
  it("builds one handler for repeated requests to the same demo", async () => {
    vi.stubEnv("AGENT_URL_AGNO", "http://agno:8000");

    await serve("agno", "subagents");
    await serve("agno", "subagents");
    await serve("agno", "subagents");

    expect(createCopilotRuntimeHandler).toHaveBeenCalledTimes(1);
  });

  it("builds ONE handler for concurrent first requests to a COLD key", async () => {
    // The D6 probe fan-out shape: several requests for the same cold key in
    // flight at once. It holds because the whole lookup-build-store path is
    // SYNCHRONOUS, so a single-threaded runtime cannot interleave two of them —
    // the first always stores its entry before the second looks the key up.
    //
    // This test is here to fail if that stops being true. An `await` introduced
    // anywhere between `handlerCache.get` and `cacheBuild` would let each
    // concurrent request build its own handler, each firing
    // `fireInstanceCreatedTelemetry`, with all but one handler discarded — and
    // nothing else in this file would notice.
    vi.stubEnv("AGENT_URL_AGNO", "http://agno:8000");

    await Promise.all([
      serve("agno", "subagents"),
      serve("agno", "subagents"),
      serve("agno", "subagents"),
      serve("agno", "subagents"),
    ]);

    expect(createCopilotRuntimeHandler).toHaveBeenCalledTimes(1);
  });

  it("builds a separate handler per demo", async () => {
    vi.stubEnv("AGENT_URL_AGNO", "http://agno:8000");

    await serve("agno", "subagents");
    await serve("agno", "mcp-apps");

    expect(createCopilotRuntimeHandler).toHaveBeenCalledTimes(2);
  });

  it("rebuilds when the environment changes the resolution", async () => {
    // Resolution still runs per request, so a changed env lands on a new
    // key instead of being served a stale handler.
    vi.stubEnv("AGENT_URL_AGNO", "http://agno:8000");
    await serve("agno", "subagents");
    vi.stubEnv("AGENT_URL_AGNO", "http://agno-staging:8000");
    await serve("agno", "subagents");

    expect(createCopilotRuntimeHandler).toHaveBeenCalledTimes(2);
  });

  it("rebuilds when LANGSMITH_API_KEY changes — the one input resolution does not produce", async () => {
    // `buildAgent` reads it straight from `process.env` and BAKES it into the
    // LangGraph agent. Left out of the key, this module's promise that "an env
    // change lands on a new key instead of being served stale" would be false
    // for exactly one variable, and a rotated key would keep tracing to the old
    // project for the life of the process.
    vi.stubEnv("AGENT_URL_LANGGRAPH_PYTHON", "http://langgraph-python:8123");
    vi.stubEnv("LANGSMITH_API_KEY", "ls-one");
    await serve("langgraph-python", "agentic-chat");
    vi.stubEnv("LANGSMITH_API_KEY", "ls-two");
    await serve("langgraph-python", "agentic-chat");

    expect(createCopilotRuntimeHandler).toHaveBeenCalledTimes(2);
  });

  it("rebuilds when the reasoning shim is switched on or off", async () => {
    // The flag is derived from the manifest, not from the target/options the
    // rest of the key fingerprints, so nothing else in the key moves when a
    // manifest adds or drops an id under `synthetic_reasoning_demos`. Left out,
    // the process would keep serving the old shim state for a demo whose
    // manifest now says the opposite.
    craftResolution({ injectSyntheticReasoning: false });
    await serve("strands", "agentic-chat");
    craftResolution({ injectSyntheticReasoning: true });
    await serve("strands", "agentic-chat");

    expect(createCopilotRuntimeHandler).toHaveBeenCalledTimes(2);
  });

  it("does not let two ROUTES share one handler, even at the same basePath", async () => {
    // `/api/<slug>/auth` is what both the auth route and the generic route
    // with `demo === "auth"` compute, so basePath cannot discriminate them. A
    // shared slot here means the auth demo can be served by the handler that
    // carries NO gate.
    vi.stubEnv("AGENT_URL_AGNO", "http://agno:8000");
    const common = {
      slug: "agno",
      demoId: "subagents",
      basePath: "/api/agno/subagents",
      // HELD IDENTICAL between the two calls on purpose. The real `auth` route
      // is multi-route while the generic one is single-route, so varying `mode`
      // here would split the key on its own and the test would pass without
      // proving anything about `routeId`. Pinning it leaves `routeId` as the
      // only difference, which is exactly the claim under test.
      mode: "single-route" as const,
    };

    await handleDemoRequest(plainRequest(), { ...common, routeId: "generic" });
    await handleDemoRequest(plainRequest(), { ...common, routeId: "auth" });

    expect(createCopilotRuntimeHandler).toHaveBeenCalledTimes(2);
  });

  it("does not let two different HOOKS objects share one handler", async () => {
    // `hooks` is baked into the memoised handler and cannot be fingerprinted
    // by value, so identity is in the key. A comment is not a guard.
    vi.stubEnv("AGENT_URL_AGNO", "http://agno:8000");
    const common = {
      routeId: "generic",
      slug: "agno",
      demoId: "subagents",
      basePath: "/api/agno/subagents",
      mode: "single-route" as const,
    };
    const gate: RuntimeHooks = { onRequest: () => {} };
    const otherGate: RuntimeHooks = { onRequest: () => {} };

    await handleDemoRequest(plainRequest(), { ...common, hooks: gate });
    await handleDemoRequest(plainRequest(), { ...common, hooks: otherGate });
    expect(createCopilotRuntimeHandler).toHaveBeenCalledTimes(2);

    // ...and the same hoisted object still memoises, which is what keeps the
    // per-handler telemetry event once-per-deployment.
    await handleDemoRequest(plainRequest(), { ...common, hooks: gate });
    expect(createCopilotRuntimeHandler).toHaveBeenCalledTimes(2);
  });

  it("does not let two different runtimeExtras objects share one handler", async () => {
    vi.stubEnv("AGENT_URL_AGNO", "http://agno:8000");
    const common = {
      routeId: "voice",
      slug: "agno",
      demoId: "subagents",
      basePath: "/api/agno/subagents",
      mode: "multi-route" as const,
    };

    await handleDemoRequest(plainRequest(), {
      ...common,
      runtimeExtras: { transcriptionService: {} },
    });
    await handleDemoRequest(plainRequest(), {
      ...common,
      runtimeExtras: { transcriptionService: {} },
    });

    expect(createCopilotRuntimeHandler).toHaveBeenCalledTimes(2);
  });

  it("caps the cache, so an interpolated mutable value cannot grow it forever", async () => {
    // The manifests bound the LEGITIMATE key space, but the fingerprint
    // includes `${VAR}`-expanded values: a placeholder carrying per-tenant
    // data would mint a key per value. Eviction only costs a rebuild.
    for (let index = 0; index < HANDLER_CACHE_MAX + 5; index += 1) {
      craftResolution({ agentName: `agent-${index}` });
      await serve("strands", "agentic-chat");
    }
    expect(handlerCacheSizeForTests()).toBe(HANDLER_CACHE_MAX);
  });

  it("never caches a failure arm", async () => {
    // Error arms build a fresh Response each time. Caching one would serve a
    // body that has already been consumed.
    const first = await serve("langgraph-python", "agentic-chat");
    const second = await serve("langgraph-python", "agentic-chat");
    expect(first.body.message).toBe(second.body.message);
    expect(createCopilotRuntimeHandler).not.toHaveBeenCalled();
  });
});
