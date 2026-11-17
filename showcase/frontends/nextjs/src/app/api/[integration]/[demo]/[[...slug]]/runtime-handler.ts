// Request handling for the runtime routes. route.ts next to this file serves
// /api/<integration>/<demo>, and the auth and voice routes serve
// /api/<integration>/auth and /api/<integration>/voice with the same handler.
import { randomUUID } from "node:crypto";
import {
  CopilotRuntime,
  TranscriptionService,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type {
  CopilotRuntimeHooks,
  TranscribeFileOptions,
} from "@copilotkit/runtime/v2";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";
import { DEMO_RUNTIME_OPTIONS } from "@/demo-runtime-options";
import {
  UnconfiguredIntegrationError,
  unsetVariables,
  withForwardedHeaders,
} from "@/lib/agents";
import type { RuntimeOptions, loadIntegration } from "@/lib/agents";
import { DEMO_AUTH_HEADER } from "@/lib/demo-auth";

/** The integration and the demo that a request is for. */
export interface DemoTarget {
  integration: string;
  demo: string;
}

/** What one route gives every runtime it builds. */
export interface DemoRouteSettings {
  /** Loads an integration. The routes pass `loadIntegration`; tests pass a fake. */
  loadIntegration: typeof loadIntegration;
  /**
   * Runtime options for every demo of the route. They replace the demo's
   * `DEMO_RUNTIME_OPTIONS` entry, and the integration's own options replace
   * them, key by key.
   */
  runtimeOptions?: RuntimeOptions;
  /** Request hooks for every demo of the route, for example an auth check. */
  hooks?: CopilotRuntimeHooks;
}

interface TransportSettings {
  runtime: CopilotRuntime;
  basePath: string;
  hooks?: CopilotRuntimeHooks;
  /** Whether the runtime has an MCP Apps server, reported by GET /info. */
  mcpAppsEnabled: boolean;
}

// The runtime's GET /info reports A2UI and Open Generative UI but not MCP
// Apps. The route adds `mcpAppsEnabled`, so a spec can tell whether a demo's
// runtime serves MCP Apps without knowing the integration.
async function withMcpAppsEnabled(response: Response, mcpAppsEnabled: boolean) {
  const info: unknown = await response.json();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  const body =
    typeof info === "object" && info !== null
      ? { ...info, mcpAppsEnabled }
      : info;
  return Response.json(body, { status: response.status, headers });
}

// Serves both client transports from one runtime. A single-route client posts
// `{ method, params, body }` envelopes to the base path itself. A REST client
// calls paths under it: GET /info, POST /agent/<id>/run, and so on. A client
// with no `useSingleEndpoint` asks GET /info first, so it gets REST.
function createTransportHandler({
  mcpAppsEnabled,
  ...settings
}: TransportSettings) {
  const singleRoute = createCopilotRuntimeHandler({
    ...settings,
    mode: "single-route",
  });
  const multiRoute = createCopilotRuntimeHandler(settings);
  const infoPath = `${settings.basePath}/info`;
  return async (request: Request) => {
    const { pathname } = new URL(request.url);
    if (pathname === settings.basePath) return singleRoute(request);
    const response = await multiRoute(request);
    const isInfo = request.method === "GET" && pathname === infoPath;
    return isInfo && response.ok
      ? withMcpAppsEnabled(response, mcpAppsEnabled)
      : response;
  };
}

function unconfigured(missing: string[]) {
  return Response.json({ error: "unconfigured", missing }, { status: 404 });
}

// Logs the error under a new id. The body carries only the id, never a
// message or a stack trace.
function internalError({ integration, demo }: DemoTarget, error: unknown) {
  const errorId = randomUUID();
  console.error(`[api/${integration}/${demo}] error ${errorId}:`, error);
  return Response.json(
    { error: "internal runtime error", errorId },
    { status: 500 },
  );
}

/**
 * Creates the request handler of a runtime route. For each integration and
 * demo, it builds one `CopilotRuntime` on the first request and keeps it:
 *
 *   new CopilotRuntime({
 *     ...DEMO_RUNTIME_OPTIONS[demo],
 *     ...settings.runtimeOptions,
 *     ...config.options,
 *     agents: config.agents,
 *   })
 *
 * The runtime's base path is `/api/<integration>/<demo>`. Each request runs
 * inside `withForwardedHeaders`, so in-process agents can read its `x-*`
 * headers.
 *
 * The handler answers these requests without a runtime:
 * - 404 `{ error: "unknown integration" }`: no manifest has the slug, or it is
 *   not kebab-case.
 * - 404 `{ error: "unconfigured", missing }`: address variables are not set.
 * - 404 `{ error: "unknown demo" }`: `createRuntimeConfig(demo)` returned
 *   `undefined`.
 * - 500 `{ error: "internal runtime error", errorId }`: anything else failed.
 *   The error is logged with the same id.
 *
 * @example
 * const handleDemoRequest = createDemoRouteHandler({ loadIntegration });
 * export async function POST(request: Request, { params }: { params: Promise<DemoTarget> }) {
 *   return handleDemoRequest(request, await params);
 * }
 */
export function createDemoRouteHandler(settings: DemoRouteSettings) {
  const handlers = new Map<string, (request: Request) => Promise<Response>>();

  // The handler of a demo's runtime, or the answer when there is none.
  async function resolveHandler({ integration, demo }: DemoTarget) {
    const key = `${integration}/${demo}`;
    const cached = handlers.get(key);
    if (cached !== undefined) return cached;

    const loaded = await settings.loadIntegration(integration);
    if (loaded === undefined) {
      return Response.json({ error: "unknown integration" }, { status: 404 });
    }
    const missing = unsetVariables(loaded.env);
    if (missing.length > 0) return unconfigured(missing);
    const config = loaded.runtime.createRuntimeConfig(demo);
    if (config === undefined) {
      return Response.json({ error: "unknown demo" }, { status: 404 });
    }

    const options: RuntimeOptions = {
      ...DEMO_RUNTIME_OPTIONS[demo],
      ...settings.runtimeOptions,
      ...config.options,
    };
    const runtime = new CopilotRuntime({ ...options, agents: config.agents });
    const handler = createTransportHandler({
      runtime,
      basePath: `/api/${integration}/${demo}`,
      hooks: settings.hooks,
      mcpAppsEnabled: (options.mcpApps?.servers.length ?? 0) > 0,
    });
    handlers.set(key, handler);
    return handler;
  }

  return async function handleDemoRequest(
    request: Request,
    target: DemoTarget,
  ) {
    try {
      const handler = await resolveHandler(target);
      if (handler instanceof Response) return handler;
      return await withForwardedHeaders(request, () => handler(request));
    } catch (error) {
      // An agent read an address variable that the integration's env.ts
      // does not list.
      if (error instanceof UnconfiguredIntegrationError) {
        return unconfigured([error.variable]);
      }
      return internalError(target, error);
    }
  };
}

/**
 * Request hooks for the auth demo: a request whose `Authorization` header is
 * not `DEMO_AUTH_HEADER` gets a 401 before it reaches the agent.
 */
export const DEMO_AUTH_HOOKS: CopilotRuntimeHooks = {
  onRequest({ request }) {
    if (request.headers.get("authorization") === DEMO_AUTH_HEADER) return;
    throw Response.json(
      {
        error: "unauthorized",
        message:
          "Missing or invalid Authorization header. Click Authenticate above to send messages.",
      },
      { status: 401 },
    );
  },
};

// OpenAI transcription that reads OPENAI_API_KEY on each call. Without the
// key it fails with an "api key missing" error, which the runtime answers
// with a 401.
class GuardedOpenAITranscriptionService extends TranscriptionService {
  async transcribeFile(options: TranscribeFileOptions) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY not configured for this deployment (api key missing). " +
          "Set OPENAI_API_KEY to enable voice transcription.",
      );
    }
    const openai = new OpenAI({ apiKey });
    return new TranscriptionServiceOpenAI({ openai }).transcribeFile(options);
  }
}

/**
 * Runtime options for the voice demo: OpenAI transcription. An integration
 * that sets `transcriptionService` in its own options replaces it.
 */
export const VOICE_RUNTIME_OPTIONS: RuntimeOptions = {
  transcriptionService: new GuardedOpenAITranscriptionService(),
};
