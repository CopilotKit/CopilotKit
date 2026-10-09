/**
 * Seam for `agent_kind: in-process` integrations — the agent runs INSIDE
 * this Next.js app, so no agent URL is dialled at all.
 *
 * `built-in-agent` is the only integration that declares it, and that is
 * permanent: the integration exists to demonstrate that CopilotKit can run an
 * agent inside the Next.js process, so it can never become a separate service.
 * Its agent code therefore has to live in this app.
 *
 * PROVENANCE — the ported tree
 * ----------------------------
 * `src/lib/built-in-agent/**` is a BYTE-IDENTICAL copy of
 * `showcase/integrations/built-in-agent/src/lib/**`:
 *
 *   built-in-agent/header-forwarding.ts        <- src/lib/header-forwarding.ts
 *   built-in-agent/factory/tanstack-factory.ts <- src/lib/factory/tanstack-factory.ts
 *   built-in-agent/factory/agentic-chat-factory.ts
 *   built-in-agent/factory/reasoning-factory.ts
 *   built-in-agent/factory/demo-prompts.ts
 *   built-in-agent/factory/demo-stream.ts
 *   built-in-agent/factory/server-tools.ts
 *   built-in-agent/factory/state-tools.ts
 *   built-in-agent/factory/subagent-tools.ts
 *   built-in-agent/factory/a2ui-factory.ts
 *   built-in-agent/factory/a2ui-fixed-schema-factory.ts
 *   built-in-agent/factory/beautiful-chat-factory.ts
 *   built-in-agent/factory/byoc-hashbrown-factory.ts
 *   built-in-agent/factory/byoc-json-render-factory.ts
 *   built-in-agent/factory/mcp-apps-factory.ts
 *   built-in-agent/factory/multimodal-factory.ts
 *   built-in-agent/factory/ogui-factory.ts
 *
 * Keep them byte-identical. `diff -r` between the two trees is the cheapest
 * drift check there is, and the transitive dependencies (demo-stream,
 * server-tools, state-tools, subagent-tools) are easy to forget when
 * re-syncing. `in-process-agents.test.ts` asserts byte parity for every file
 * in that list.
 *
 * ONE FILE IS NOT A VERBATIM COPY:
 *
 *   built-in-agent/factory/agent-config-factory.ts
 *
 * Upstream that agent has no factory module — it is written INLINE inside
 * `src/app/api/copilotkit-agent-config/route.ts`. Only the agent half was
 * lifted out; see the header of that file for the exact delta.
 *
 * NOT PORTED ON PURPOSE: `src/cvdiag-backend.ts` and the cvdiag emitter.
 * `withCvdiagBackend` wraps a ROUTE HANDLER, not an agent, and the emitter is
 * machine-staged by `bin/showcase cvdiag-stage-ts`. No factory below depends
 * on either.
 *
 * RUNTIME OPTIONS ARE NOT SUPPLIED HERE. Several of these agents only behave
 * correctly when the runtime that hosts them also carries a flag that the
 * upstream route sets alongside the agent:
 *
 *   declarative-gen-ui  a2ui: { injectA2UITool: false,
 *                              defaultCatalogId: "declarative-gen-ui-catalog" }
 *   a2ui-recovery       same as declarative-gen-ui
 *   a2ui-fixed-schema   a2ui: { injectA2UITool: false }
 *   mcp-apps            mcpApps: { servers: [excalidraw] }
 *   beautiful-chat      openGenerativeUI: true
 *                       a2ui: { injectA2UITool: true,
 *                               defaultCatalogId:
 *                                 "copilotkit://app-dashboard-catalog" }
 *                       mcpApps: { servers: [excalidraw] }
 *   open-gen-ui         openGenerativeUI: { agents: ["open-gen-ui",
 *   open-gen-ui-advanced                              "open-gen-ui-advanced"] }
 *
 * Those come from the manifests (`demos[].runtime`) and are applied by the
 * route. The agents below still CONSTRUCT without them — they just render
 * nothing useful if the flag is missing.
 *
 * HEADER FORWARDING IS NOT COMPLETE HERE — READ THIS
 * --------------------------------------------------
 * `forwardingFetch` (used by every factory below) re-attaches inbound `x-*`
 * headers — notably `x-aimock-context` — onto the outbound LLM call. It reads
 * them out of an AsyncLocalStorage scope that `withForwardedHeaders` must
 * establish AROUND the request. built-in-agent's own route does that in the
 * route handler.
 *
 * This seam is agent-shaped: `InProcessAgentFactory` receives no `Request`, so
 * it cannot open that scope. `handleDemoRequest` in `src/lib/demo-runtime.ts`
 * therefore wraps its `serve(req)` call in {@link withInProcessRequestScope},
 * and that wrap is load-bearing: remove it and `x-aimock-context` never reaches
 * aimock, every fixture lookup misses, and every built-in-agent cell goes red
 * while looking like a model problem.
 */

import { createBuiltInAgent } from "@/lib/built-in-agent/factory/tanstack-factory";
import { createAgenticChatAgent } from "@/lib/built-in-agent/factory/agentic-chat-factory";
import {
  createAgenticChatReasoningAgent,
  createReasoningDefaultRenderAgent,
  createToolRenderingReasoningChainAgent,
} from "@/lib/built-in-agent/factory/reasoning-factory";
import {
  GEN_UI_AGENT_PROMPT,
  GEN_UI_TOOL_BASED_PROMPT,
  SUBAGENTS_PROMPT,
} from "@/lib/built-in-agent/factory/demo-prompts";
import {
  createA2UIRecoveryAgent,
  createDeclarativeGenUIAgent,
} from "@/lib/built-in-agent/factory/a2ui-factory";
import { createA2UIFixedSchemaAgent } from "@/lib/built-in-agent/factory/a2ui-fixed-schema-factory";
import { createBeautifulChatAgent } from "@/lib/built-in-agent/factory/beautiful-chat-factory";
import { createByocHashbrownAgent } from "@/lib/built-in-agent/factory/byoc-hashbrown-factory";
import { createByocJsonRenderAgent } from "@/lib/built-in-agent/factory/byoc-json-render-factory";
import { createMcpAppsAgent } from "@/lib/built-in-agent/factory/mcp-apps-factory";
import { createMultimodalAgent } from "@/lib/built-in-agent/factory/multimodal-factory";
import { createOguiAgent } from "@/lib/built-in-agent/factory/ogui-factory";
import { createAgentConfigAgent } from "@/lib/built-in-agent/factory/agent-config-factory";
import { withForwardedHeaders } from "@/lib/built-in-agent/header-forwarding";

/** Anything the runtime accepts in its `agents` record. */
export type InProcessAgent = unknown;

/**
 * `agentName` is the name the demo registers under (`agent.name` from the
 * manifest, else the demo id), so a factory can branch on it the way
 * built-in-agent's `/api/copilotkit` route branches on its agent map.
 */
export type InProcessAgentFactory = (args: {
  slug: string;
  demoId: string;
  agentName: string;
}) => InProcessAgent;

/* -------------------------------------------------------------------------
 * built-in-agent
 * ---------------------------------------------------------------------- */

/**
 * Agent name -> builder, transcribed from built-in-agent's own route files.
 *
 * The keys are AGENT NAMES, not demo ids, because that is what those routes
 * key on and what `resolveAgentName` produces here (`agent.name` from the
 * manifest, else the demo id). The two coincide for most demos; where the
 * manifest overrides the name (`agentic_chat`, `frontend_tools`, `auth-demo`,
 * `voice-demo`, ...) the override is the key.
 *
 * Sources:
 *   src/app/api/copilotkit/route.ts             — the bulk of the map
 *   src/app/api/copilotkit-auth/[[...slug]]     — auth-demo
 *   src/app/api/copilotkit-voice/[[...slug]]    — voice-demo
 *   src/app/api/copilotkit-mcp-apps/route.ts    — headless-complete
 *   src/app/api/copilotkit-reasoning/route.ts   — the reasoning aliases
 */
const BUILT_IN_AGENT_BUILDERS: Readonly<Record<string, () => InProcessAgent>> =
  Object.freeze({
    // NO `default` KEY. It used to exist as
    // `default: () => createBuiltInAgent()`, described as a "catch-all agent
    // retained during the LGP-parity migration", and it handed any manifest
    // setting `agent.name: default` precisely the silent generic-agent fallback
    // that `builtInAgentFactory` below spends a paragraph forbidding: the
    // generic agent answers, streams text, and produces a demo that looks
    // plausible while rendering nothing. A catch-all in a map whose ONLY job is
    // to make an unregistered name throw is a hole in the map, not a fallback.
    // Nothing reached it — no manifest sets `agent.name: default`, and
    // built-in-agent is the only `agent_kind: in-process` integration — so an
    // unregistered name now hits the throw, as intended.

    agentic_chat: () => createAgenticChatAgent(),

    "chat-customization-css": () => createBuiltInAgent(),
    "chat-slots": () => createBuiltInAgent(),
    "prebuilt-popup": () => createBuiltInAgent(),
    "prebuilt-sidebar": () => createBuiltInAgent(),
    "headless-simple": () => createBuiltInAgent(),
    // copilotkit-mcp-apps/route.ts registers headless-complete on the generic
    // agent; only the `mcp-apps` demo on that route needs the MCP factory.
    "headless-complete": () => createBuiltInAgent(),

    frontend_tools: () => createBuiltInAgent(),
    "frontend-tools-async": () => createBuiltInAgent(),

    "tool-rendering": () => createBuiltInAgent(),
    "tool-rendering-default-catchall": () => createBuiltInAgent(),
    "tool-rendering-custom-catchall": () => createBuiltInAgent(),

    "gen-ui-agent": () =>
      createBuiltInAgent({ systemPrompt: GEN_UI_AGENT_PROMPT }),
    "gen-ui-tool-based": () =>
      createBuiltInAgent({ systemPrompt: GEN_UI_TOOL_BASED_PROMPT }),
    "gen-ui-interrupt": () => createBuiltInAgent(),
    "interrupt-headless": () => createBuiltInAgent(),

    // NO `human_in_the_loop` KEY. It was dead in both directions: it is not a
    // built-in-agent demo id, and no manifest sets it as an `agent.name`. The
    // two reasoning aliases below are kept for a stated reason (a manifest that
    // re-enables them must resolve rather than throw); this key carried no such
    // reason, so it was only a name the map would accept without any demo ever
    // asking for it. `hitl-in-chat` / `hitl-in-app` are the real HITL demo ids.
    "hitl-in-chat": () => createBuiltInAgent(),
    "hitl-in-app": () => createBuiltInAgent(),

    "shared-state-read": () => createBuiltInAgent(),
    "shared-state-read-write": () => createBuiltInAgent(),
    "shared-state-streaming": () => createBuiltInAgent(),
    "readonly-state-agent-context": () => createBuiltInAgent(),

    subagents: () => createBuiltInAgent({ systemPrompt: SUBAGENTS_PROMPT }),
    // Not a manifest demo id today. built-in-agent's manifest deliberately
    // carries `threadid-frontend-tool-roundtrip` in NEITHER `features` nor
    // `demos` — the `constrained-explicit` allowlist in
    // showcase/shared/constraints.yaml does not list the id, so a `demos` row
    // fails validate-constraints; see the NOTE at the bottom of that manifest
    // for the three-step unblock. Kept here for the same reason as the reasoning
    // aliases below: when the id is re-enabled the name must resolve rather than
    // throw.
    "threadid-frontend-tool-roundtrip": () => createBuiltInAgent(),

    // Reasoning demos — visible chain-of-thought via the reasoning adapter.
    "reasoning-custom": () => createAgenticChatReasoningAgent(),
    "reasoning-default": () => createReasoningDefaultRenderAgent(),
    "tool-rendering-reasoning-chain": () =>
      createToolRenderingReasoningChainAgent(),
    // Aliases registered by copilotkit-reasoning/route.ts. Not manifest demo
    // ids today (they sit in `not_supported_features`), kept so a manifest that
    // re-enables them resolves instead of throwing.
    "agentic-chat-reasoning": () => createAgenticChatReasoningAgent(),
    "reasoning-default-render": () => createReasoningDefaultRenderAgent(),

    // Dedicated routes in built-in-agent, but both run the GENERIC agent — the
    // per-demo difference is the route's gate / transcription service, which
    // this app already expresses in src/app/api/[integration]/{auth,voice}.
    "auth-demo": () => createBuiltInAgent(),
    "voice-demo": () => createBuiltInAgent(),

    // Demos whose upstream route owns a dedicated factory. Each needs a runtime
    // flag too — see the RUNTIME OPTIONS table at the top of this file.
    //
    // copilotkit-declarative-gen-ui/route.ts + copilotkit-a2ui-recovery/route.ts
    "declarative-gen-ui": () => createDeclarativeGenUIAgent(),
    "a2ui-recovery": () => createA2UIRecoveryAgent(),
    // copilotkit-a2ui-fixed-schema/route.ts
    "a2ui-fixed-schema": () => createA2UIFixedSchemaAgent(),
    // copilotkit-mcp-apps/route.ts — the `headless-complete` entry above shares
    // that route but runs the generic agent, exactly as upstream does.
    "mcp-apps": () => createMcpAppsAgent(),
    // copilotkit-declarative-json-render/route.ts
    byoc_json_render: () => createByocJsonRenderAgent(),
    // copilotkit-beautiful-chat/route.ts
    "beautiful-chat": () => createBeautifulChatAgent(),
    // copilotkit-multimodal/route.ts
    "multimodal-demo": () => createMultimodalAgent(),
    // copilotkit-declarative-hashbrown/route.ts
    "declarative-hashbrown-demo": () => createByocHashbrownAgent(),
    // copilotkit-ogui/route.ts registers both names on the same factory.
    "open-gen-ui": () => createOguiAgent(),
    "open-gen-ui-advanced": () => createOguiAgent(),
    // copilotkit-agent-config/route.ts — agent extracted out of the route.
    "agent-config-demo": () => createAgentConfigAgent(),
  });

/**
 * Every agent built-in-agent declares now has a builder above, so an unknown
 * name means the manifest and this map have drifted.
 *
 * It fails LOUD rather than silently falling back to the generic agent: a
 * generic agent would answer, stream text, and produce a demo that looks
 * plausible while rendering nothing — the exact failure mode that costs a day
 * to trace.
 *
 * TWO THINGS KEEP THAT PROMISE, AND BOTH ARE LOAD-BEARING:
 *
 * 1. `Object.hasOwn`, never a bare index. `BUILT_IN_AGENT_BUILDERS["constructor"]`
 *    is `Object` — truthy, callable, and it returns `{}`. That empty object
 *    would be handed to CopilotRuntime AS THE AGENT, which is the exact
 *    silent fallback this function exists to prevent.
 * 2. NO demo-id fallback. When the manifest sets no `agent.name`,
 *    `resolveAgentName` already returns the demo id, so `agentName === demoId`
 *    and a second lookup would ask the same question twice. The fallback is
 *    only reachable when `agent.name` WAS set and is unregistered — and then
 *    the demo id may happen to name a DIFFERENT registered agent, so the
 *    fallback would serve another demo's agent under this demo's page. That
 *    is drift; it throws, naming both.
 */
const builtInAgentFactory: InProcessAgentFactory = ({ demoId, agentName }) => {
  if (Object.hasOwn(BUILT_IN_AGENT_BUILDERS, agentName)) {
    return BUILT_IN_AGENT_BUILDERS[agentName]();
  }

  throw new Error(
    `built-in-agent has no in-process agent registered for demo ` +
      `${JSON.stringify(demoId)} (agent ${JSON.stringify(agentName)}). ` +
      `Add it to BUILT_IN_AGENT_BUILDERS in src/lib/in-process-agents.ts. ` +
      `If built-in-agent gained a new dedicated route, port its factory from ` +
      `showcase/integrations/built-in-agent/src/lib/factory/ first and keep ` +
      `the copy byte-identical.`,
  );
};

/* -------------------------------------------------------------------------
 * Registry
 * ---------------------------------------------------------------------- */

/** Keyed by integration slug. */
export const IN_PROCESS_AGENT_FACTORIES: Readonly<
  Record<string, InProcessAgentFactory>
> = Object.freeze({
  "built-in-agent": builtInAgentFactory,
});

/**
 * The slug arrives from a URL segment, so the lookup is `hasOwn`-guarded:
 * `/api/constructor/...` would otherwise return `Object` — a truthy
 * "factory" — and every caller here treats truthy as "this integration runs
 * its agent in process".
 */
export function getInProcessAgentFactory(
  slug: string,
): InProcessAgentFactory | undefined {
  return Object.hasOwn(IN_PROCESS_AGENT_FACTORIES, slug)
    ? IN_PROCESS_AGENT_FACTORIES[slug]
    : undefined;
}

/**
 * Run `fn` inside the request scope an in-process agent needs.
 *
 * For `built-in-agent` this snapshots the inbound `x-*` headers into the
 * AsyncLocalStorage scope that `forwardingFetch` reads at outbound-LLM-call
 * time. Without it `x-aimock-context` never reaches aimock, every fixture
 * lookup 404s, and the whole integration goes red.
 *
 * A no-op pass-through for every slug with no in-process agent, so
 * `handleDemoRequest` can wrap unconditionally:
 *
 *     return withInProcessRequestScope(slug, req, () => handler(req));
 */
export function withInProcessRequestScope<T>(
  slug: string,
  req: { headers: Headers },
  fn: () => Promise<T> | T,
): Promise<T> | T {
  if (!getInProcessAgentFactory(slug)) return fn();
  return withForwardedHeaders(req, fn);
}
