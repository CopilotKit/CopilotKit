import {
  CopilotRuntime,
  createCopilotHonoHandler,
  InMemoryAgentRunner,
  CopilotKitIntelligence,
} from "@copilotkit/runtime/v2";
import type { IdentifyUserCallback } from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { agentRegistry, agentIds } from "@/shell/agent-registry";
import { defaultSkinId } from "@/shell/skins-config";

// One BuiltInAgent per registered skin, keyed by the skin id (=== agentId). The
// client's CopilotChatConfigurationProvider now sends agentId={skin.id}
// ("banking" / "airline"), so the runtime must resolve each skin's agent by
// that id — a single `default` agent would 404 the per-skin runs. Built once at
// module load (the factories are cheap and stateless per process).
function buildAgents() {
  return Object.fromEntries(
    agentIds.map((id) => [id, agentRegistry[id].createAgent()]),
  );
}

/**
 * Self-learning backend (Phase C), env-gated.
 *
 * When the three Intelligence env vars below are all set, the runtime is built
 * in Intelligence mode: the local `bankingAgent` still executes here (calling
 * OpenAI), but every AG-UI event of every run is streamed over a Phoenix
 * WebSocket to the Intelligence gateway for durable threads + self-learning
 * ingestion (the `IntelligenceAgentRunner` does both — see
 * packages/runtime/src/v2/runtime/runner/intelligence.ts). Officer actions the
 * gateway later distills into `/knowledge` are what a fresh agent reads back to
 * learn the over-limit unlock unaided.
 *
 * When ANY of the three is missing, the runtime falls back to the exact OSS
 * path: a pure SSE `CopilotRuntime` + `InMemoryAgentRunner`, with no network
 * dependency on an Intelligence stack. This is the default and must not regress.
 *
 *   INTELLIGENCE_API_URL          e.g. http://localhost:4201
 *   INTELLIGENCE_GATEWAY_WS_URL   e.g. ws://localhost:4401
 *   INTELLIGENCE_API_KEY          e.g. cpk_...
 *   COPILOTKIT_LICENSE_TOKEN      (optional) read automatically by the runtime
 */
const intelligenceApiUrl = process.env.INTELLIGENCE_API_URL;
const intelligenceWsUrl = process.env.INTELLIGENCE_GATEWAY_WS_URL;
const intelligenceApiKey = process.env.INTELLIGENCE_API_KEY;

const intelligenceEnabled = Boolean(
  intelligenceApiUrl && intelligenceWsUrl && intelligenceApiKey,
);

/**
 * Resolve a stable end-user identity for Intelligence requests, PER SKIN.
 *
 * The shared route hosts every skin's agent, so it must NOT know any single
 * skin's identity scheme. Instead it reads the target agentId from the request
 * URL (`/agent/:agentId/run|suggest|connect`), looks up that skin's optional
 * `identifyUser` in the server agent registry, and delegates to it.
 *
 * Requests with NO agentId in the URL are app-level, not skin-scoped: the
 * inspector's `/memories/list` + `/memories/recall` and `/info`. The app's
 * DEFAULT skin owns app-level identity, so these delegate to
 * `agentRegistry[defaultSkinId]?.identifyUser` — keeping the shell
 * skin-agnostic (it asks whichever skin is `defaultSkinId`, never "banking" by
 * name). This matters because the default skin's memory scope is exactly what
 * the inspector must read: routing agentId-less requests through the generic
 * identity instead would resolve a non-seeded id that 403s against the
 * Intelligence stack in the demo's documented unpinned configuration.
 *
 * A skin that contributes no resolver (e.g. airline, which has no memory), and
 * the case where the default skin itself has no resolver, fall back to a
 * generic, skin-agnostic identity.
 *
 * The client forwards the active user via CopilotKit `properties`
 * (`{ userRole, userId }`), which the runtime places in the run body's
 * `forwardedProps` (a run POST body is a RunAgentInput). We read both
 * `forwardedProps` and a top-level `properties` for robustness.
 *
 * The generic fallback honors INTELLIGENCE_USER_ID / INTELLIGENCE_USER_NAME so
 * CI/smokes (and backends that verify the asserted user is a seeded member)
 * stay deterministic on a single pinned identity; otherwise it returns one
 * stable demo id rather than minting random ids (random ids fragment threads).
 */
function agentIdFromUrl(url: string): string | undefined {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const i = segments.lastIndexOf("agent");
    if (i >= 0 && i + 1 < segments.length) {
      return decodeURIComponent(segments[i + 1]!);
    }
  } catch {
    // Malformed URL — treat as "no agentId" and fall back.
  }
  return undefined;
}

async function readForwardedProperties(
  request: Request,
): Promise<{ userRole?: string; userId?: string } | undefined> {
  try {
    const body = (await request.clone().json()) as {
      forwardedProps?: { userRole?: string; userId?: string };
      properties?: { userRole?: string; userId?: string };
    } | null;
    return body?.forwardedProps ?? body?.properties ?? undefined;
  } catch {
    // Non-JSON / bodyless request (e.g. GET /info, GET /memories) — no props.
    return undefined;
  }
}

function genericIdentity(): { id: string; name: string } {
  const pinned = process.env.INTELLIGENCE_USER_ID;
  if (pinned) {
    return { id: pinned, name: process.env.INTELLIGENCE_USER_NAME ?? pinned };
  }
  return { id: "reskin-demo-user", name: "Reskinnable Demo User" };
}

const identifyUser: IdentifyUserCallback = async (request: Request) => {
  const agentId = agentIdFromUrl(request.url);
  // Skin-scoped routes resolve through their target skin; agentId-less
  // app-level routes (/memories/*, /info) resolve through the default skin.
  const resolve = agentId
    ? agentRegistry[agentId]?.identifyUser
    : agentRegistry[defaultSkinId]?.identifyUser;
  if (!resolve) return genericIdentity();
  const properties = await readForwardedProperties(request);
  return resolve(properties);
};

function createRuntime(): CopilotRuntime {
  if (intelligenceEnabled) {
    const intelligence = new CopilotKitIntelligence({
      apiUrl: intelligenceApiUrl!,
      wsUrl: intelligenceWsUrl!,
      apiKey: intelligenceApiKey!,
      // Required for the durable-memory demo: the platform's recall_memory /
      // save_memory tools live at `${apiUrl}/mcp` and are attached to the local
      // BuiltInAgent run via MCP middleware ONLY when this opt-in flag is set
      // (see attachIntelligenceEnterpriseLearning in
      // packages/runtime/.../handlers/shared/agent-utils.ts). Without it the
      // agent has no memory tools and re-offers to record every over-limit charge.
      enableEnterpriseLearning: true,
    });

    return new CopilotRuntime({
      agents: buildAgents(),
      intelligence,
      identifyUser,
      // Opt in to the client-facing /memories/* proxy routes (default off) so the
      // product web-inspector's Memory tab can list + recall memories in this
      // demo. Only meaningful in Intelligence mode; does not affect the agent's
      // own server-side recall_memory (that runs via the MCP path).
      exposeMemoryRoutes: true,
      licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
      lockTtlSeconds: 30,
      lockKeyPrefix: "northwind-lock",
      lockHeartbeatIntervalSeconds: 12,
      generateThreadNames: true,
      a2ui: { injectA2UITool: false },
      openGenerativeUI: { agents: agentIds },
    });
  }

  // OSS default — pure SSE, no external Intelligence dependency.
  return new CopilotRuntime({
    agents: buildAgents(),
    runner: new InMemoryAgentRunner(),
    a2ui: { injectA2UITool: false },
    openGenerativeUI: { agents: agentIds },
  });
}

const runtime = createRuntime();

const app = createCopilotHonoHandler({ runtime, basePath: "/api/copilotkit" });

export const GET = handle(app);
export const POST = handle(app);
