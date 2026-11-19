import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";
import type { AgentCapabilities } from "@ag-ui/core";
import { valid as validSemver } from "semver";
import { telemetry, isTelemetryDisabled } from ".";
import type { CopilotRuntimeLike } from "../core/runtime";
import type { AgentIdentifiedInfo } from "./events";

/**
 * Framework names an agent's adapter can declare through AG-UI
 * `identity.type`. Anything else is reported as `other`, so a developer's own
 * text never reaches telemetry.
 */
const KNOWN_FRAMEWORKS = new Set([
  "langgraph",
  "mastra",
  "built-in",
  "crewai",
  "adk",
  "agno",
  "pydantic-ai",
  "llamaindex",
  "ag2",
  "aws-strands",
  "microsoft-agent-framework",
  "claude-agent-sdk",
  "openai-agents",
  "langroid",
  "antigravity",
  "a2a",
  "vercel-ai-sdk",
  "langchain",
  "watsonx",
  "agent-spec",
]);

/** Declared values that name a listed framework another way. */
const FRAMEWORK_ALIASES: Record<string, string> = {
  "google-adk-js": "adk",
};

/** Longest adapter version sent. Bounds a SemVer prerelease or build tag. */
const MAX_ADAPTER_VERSION_LENGTH = 64;
const CAPABILITIES_TIMEOUT_MS = 2000;
const MAX_AGENT_NAMES_PER_CLASS = 100;

/**
 * Agent names already identified, per agent class, for the whole process.
 *
 * The key is the agent's class, not the runtime object: many apps build a new
 * `CopilotRuntime` (and new agents) inside the request handler, and a
 * per-runtime key would send the event, and call `getCapabilities()`, on every
 * request. The class object stays the same across those requests, and a
 * bundler renaming it does not change it.
 */
const identifiedAgents = new WeakMap<object, Set<string>>();

function agentClassKey(agent: AbstractAgent): object {
  const constructor = (agent as { constructor?: unknown }).constructor;
  return typeof constructor === "function" ? constructor : identifiedAgents;
}

/**
 * Whether an agent is a generic AG-UI `HttpAgent`, including one from another
 * copy of `@ag-ui/client`. Same rules as `ɵisHttpAgent` in
 * `packages/core/src/utils/http-agent.ts`; the runtime does not depend on
 * `@copilotkit/core`, so the check lives here too.
 */
export function isHttpAgentLike(agent: unknown): boolean {
  if (agent instanceof HttpAgent) return true;
  if (typeof agent !== "object" || agent === null) return false;
  const candidate = agent as Record<string, unknown>;
  return (
    typeof candidate.url === "string" &&
    typeof candidate.headers === "object" &&
    candidate.headers !== null &&
    candidate.abortController instanceof AbortController &&
    typeof candidate.runAgent === "function"
  );
}

/**
 * Reduce an agent's declared AG-UI identity to the closed set of values the
 * `oss.runtime.agent_identified` event may carry. Only `identity.type` and
 * `identity.metadata.adapterVersion` are read; names, descriptions and every
 * other identity field are dropped.
 */
export function describeAgentIdentity(
  capabilities: AgentCapabilities | undefined,
  viaHttpAgent: boolean,
): AgentIdentifiedInfo {
  const identity = capabilities?.identity;
  const declared =
    typeof identity?.type === "string"
      ? identity.type.trim().toLowerCase()
      : "";
  const normalized = FRAMEWORK_ALIASES[declared] ?? declared;
  const framework =
    normalized === ""
      ? "undeclared"
      : KNOWN_FRAMEWORKS.has(normalized)
        ? normalized
        : "other";

  const version = (identity?.metadata as Record<string, unknown> | undefined)
    ?.adapterVersion;
  const adapterVersion =
    framework !== "built-in" &&
    typeof version === "string" &&
    version.length <= MAX_ADAPTER_VERSION_LENGTH
      ? (validSemver(version) ?? undefined)
      : undefined;

  return {
    framework,
    ...(adapterVersion ? { adapter_version: adapterVersion } : {}),
    via_http_agent: viaHttpAgent,
    source: "declared",
  };
}

function capabilitiesWithTimeout(
  agent: AbstractAgent,
): Promise<AgentCapabilities | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), CAPABILITIES_TIMEOUT_MS);
  });
  // `Promise.resolve().then` turns a synchronous throw into a rejection.
  const capabilities = Promise.resolve()
    .then(() => agent.getCapabilities?.())
    .catch(() => undefined);
  return Promise.race([capabilities, timeout]).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * Send `oss.runtime.agent_identified` the first time an agent name of a given
 * agent class runs in this process. Returns at once: the capabilities lookup runs in the
 * background and never delays, blocks or fails the request.
 */
export function fireAgentIdentifiedTelemetry({
  runtime,
  agentId,
  agent,
}: {
  runtime: CopilotRuntimeLike;
  agentId: string;
  agent: AbstractAgent;
}): void {
  try {
    if (isTelemetryDisabled()) return;
    const key = agentClassKey(agent);
    let seen = identifiedAgents.get(key);
    if (!seen) {
      seen = new Set();
      identifiedAgents.set(key, seen);
    }
    if (seen.has(agentId) || seen.size >= MAX_AGENT_NAMES_PER_CLASS) return;
    // Mark first, so two parallel first requests send one event.
    seen.add(agentId);

    const viaHttpAgent = isHttpAgentLike(agent);
    const runtimeTelemetry = runtime.telemetry ?? telemetry;
    void capabilitiesWithTimeout(agent)
      .then((capabilities) =>
        runtimeTelemetry.capture(
          "oss.runtime.agent_identified",
          describeAgentIdentity(capabilities, viaHttpAgent),
        ),
      )
      .catch(() => {
        // Swallow: telemetry must never break a request.
      });
  } catch {
    // Swallow: telemetry must never break a request.
  }
}
