// The contract between the runtime routes and each integration, and the
// helpers that integrations use to build their agents. Server only.
//
// Each integration has up to two files under src/integrations/<slug>/:
// - env.ts: the address variables that its agents read. In-process
//   integrations have no env.ts.
// - agents.ts: the agents and runtime options of each demo.
import { AsyncLocalStorage } from "node:async_hooks";
import { HttpAgent } from "@ag-ui/client";
import type { AbstractAgent, HttpAgentConfig } from "@ag-ui/client";
import type { CopilotSseRuntimeOptions } from "@copilotkit/runtime/v2";
import { isKebabCase, isMissingModule } from "@/lib/integration-modules";
import { getIntegration } from "@/lib/registry";

/** Where one address variable points inside the integration's container. */
export interface AgentAddress {
  /** The port that the agent server listens on. */
  port: number;
  /** A path that follows the port, for example `/agui`. */
  path?: string;
}

/**
 * The default export of `src/integrations/<slug>/env.ts`: each address
 * variable that the integration's agents read, and where it points inside the
 * integration's container. A key is the full variable name, from `envName`.
 * The module has no side effects. `scripts/agent-env.ts` prints the values.
 *
 * @example
 * // src/integrations/strands/env.ts
 * export default {
 *   AGENT_URL_STRANDS: { port: 8000 },
 * } satisfies IntegrationEnv;
 */
export type IntegrationEnv = Record<string, AgentAddress>;

/** The `CopilotRuntime` options other than `agents`. */
export type RuntimeOptions = Omit<CopilotSseRuntimeOptions, "agents">;

/** The agents and runtime options of one demo. */
export interface RuntimeConfig {
  /** The agents, by the agent id that the demo page uses. */
  agents: Record<string, AbstractAgent>;
  /**
   * Options that replace this demo's `DEMO_RUNTIME_OPTIONS` entry, key by key,
   * for this integration only.
   */
  options?: RuntimeOptions;
}

/**
 * The default export of `src/integrations/<slug>/agents.ts`.
 *
 * `createRuntimeConfig(demoId)` returns the agents and runtime options of one
 * demo, or `undefined` for a demo that the integration does not serve. The
 * runtime route calls it once for each demo and keeps the result.
 *
 * @example
 * // src/integrations/strands/agents.ts
 * export default {
 *   createRuntimeConfig(demoId) {
 *     switch (demoId) {
 *       case "agentic-chat":
 *         return { agents: { agentic_chat: httpAgent("strands") } };
 *       case "gen-ui-interrupt":
 *         return { agents: { "gen-ui-interrupt": httpAgent("strands", "/interrupt/") } };
 *       default:
 *         return undefined;
 *     }
 *   },
 * } satisfies IntegrationRuntime;
 */
export interface IntegrationRuntime {
  createRuntimeConfig(demoId: string): RuntimeConfig | undefined;
}

/**
 * Thrown when an agent's address variable is not set, so the integration
 * cannot run in this deployment. The runtime route answers it with a 404
 * `{ error: "unconfigured" }`.
 */
export class UnconfiguredIntegrationError extends Error {
  /** The variable that is not set, for example `AGENT_URL_STRANDS`. */
  readonly variable: string;

  constructor(variable: string) {
    super(`${variable} is not set, so the agent's address is unknown.`);
    this.name = "UnconfiguredIntegrationError";
    this.variable = variable;
  }
}

/**
 * The name of one integration's address variable: `name`, an underscore,
 * then the slug in upper case with `_` for `-`.
 *
 * @example
 * envName("AGENT_URL", "langgraph-python"); // "AGENT_URL_LANGGRAPH_PYTHON"
 */
export function envName(name: string, slug: string) {
  return `${name}_${slug.toUpperCase().replaceAll("-", "_")}`;
}

/**
 * The address that the variable `envName(name, slug)` holds. It reads
 * `process.env` on each call.
 *
 * @param slug - The integration slug, for example `"strands"`.
 * @param name - The variable name without the slug. A second address uses its
 *   own name, for example `"LANGGRAPH_DEPLOYMENT_URL"`.
 * @throws UnconfiguredIntegrationError when the variable is not set or empty.
 *
 * @example
 * new LangGraphAgent({
 *   deploymentUrl: agentUrl("langgraph-python", "LANGGRAPH_DEPLOYMENT_URL"),
 *   graphId: "agentic_chat",
 * });
 */
export function agentUrl(slug: string, name = "AGENT_URL") {
  const variable = envName(name, slug);
  const value = process.env[variable];
  if (!value) throw new UnconfiguredIntegrationError(variable);
  return value;
}

/**
 * An `HttpAgent` for the integration's agent server, at `AGENT_URL_<SLUG>`
 * followed by `path`. The address and the path are joined as they are, so
 * `path` starts with `/`.
 *
 * @param slug - The integration slug.
 * @param path - The path of the agent endpoint on the server.
 * @param options - Other `HttpAgent` settings, for example `headers`.
 * @throws UnconfiguredIntegrationError when `AGENT_URL_<SLUG>` is not set.
 *
 * @example
 * httpAgent("strands", "/interrupt/"); // posts to `${AGENT_URL_STRANDS}/interrupt/`
 */
export function httpAgent(
  slug: string,
  path = "/",
  options?: Omit<HttpAgentConfig, "url">,
) {
  return new HttpAgent({ ...options, url: `${agentUrl(slug)}${path}` });
}

/** The variables of `env` that are not set (or are empty) in `process.env`. */
export function unsetVariables(env: IntegrationEnv) {
  return Object.keys(env).filter((variable) => !process.env[variable]);
}

// Only a slug from the registry reaches a dynamic import path.
function isRegisteredSlug(slug: string) {
  return isKebabCase(slug) && getIntegration(slug) !== undefined;
}

const NO_ADDRESSES: IntegrationEnv = {};

// `../integrations` is `@/integrations`. The relative form is the one that
// webpack, Turbopack, Vitest and tsx all resolve when the path holds a
// variable. An import with a variable path has no static type: each module
// states its type with `satisfies`.
async function importEnv(slug: string) {
  try {
    const loaded = await import(
      /* @vite-ignore */ `../integrations/${slug}/env`
    );
    const env: IntegrationEnv = loaded.default;
    return env;
  } catch (error) {
    if (isMissingModule(error, `${slug}/env`)) return NO_ADDRESSES;
    throw error;
  }
}

async function importRuntime(slug: string) {
  const loaded = await import(
    /* @vite-ignore */ `../integrations/${slug}/agents`
  );
  const runtime: IntegrationRuntime = loaded.default;
  return runtime;
}

/**
 * Loads `src/integrations/<slug>/env.ts`, the integration's address variables.
 *
 * @returns The env map: an empty one when the integration has no env.ts (it
 *   runs in process), or `undefined` when the slug is not kebab-case or no
 *   manifest has it.
 *
 * @example
 * const env = await loadIntegrationEnv("strands");
 * // { AGENT_URL_STRANDS: { port: 8000 } }
 */
export async function loadIntegrationEnv(slug: string) {
  if (!isRegisteredSlug(slug)) return undefined;
  return importEnv(slug);
}

/**
 * Loads an integration's env.ts and agents.ts.
 *
 * @returns `{ env, runtime }`, or `undefined` when the slug is not kebab-case
 *   or no manifest has it. `env` is empty when the integration has no env.ts.
 * @throws The import error when the integration has no agents.ts, or when one
 *   of the two modules fails to load.
 *
 * @example
 * const integration = await loadIntegration("strands");
 * const config = integration?.runtime.createRuntimeConfig("agentic-chat");
 */
export async function loadIntegration(slug: string) {
  if (!isRegisteredSlug(slug)) return undefined;
  const [env, runtime] = await Promise.all([
    importEnv(slug),
    importRuntime(slug),
  ]);
  return { env, runtime };
}

// The inbound `x-*` headers of the request that is being handled.
const inboundHeaders = new AsyncLocalStorage<Record<string, string>>();

/**
 * Runs `handle` with the `x-*` headers of `request` readable through
 * `forwardedHeaders()`, for the request and all the work it starts, streamed
 * agent runs included. The runtime routes run every request in it.
 */
export function withForwardedHeaders<T>(request: Request, handle: () => T) {
  const headers: Record<string, string> = {};
  // The Headers iterator gives lower-case names.
  request.headers.forEach((value, name) => {
    if (name.startsWith("x-")) headers[name] = value;
  });
  return inboundHeaders.run(headers, handle);
}

/**
 * The `x-*` headers of the request that is being handled, for example
 * `x-aimock-context`, with lower-case names. Empty outside a request.
 *
 * The runtime copies `x-*` and `authorization` headers onto each agent's
 * `headers`, which `HttpAgent` sends. An agent that runs in process calls its
 * LLM itself, so it adds these headers to those calls.
 *
 * @example
 * const fetchWithForwardedHeaders: typeof fetch = (input, init) => {
 *   const headers = new Headers(init?.headers);
 *   for (const [name, value] of Object.entries(forwardedHeaders())) {
 *     if (!headers.has(name)) headers.set(name, value);
 *   }
 *   return fetch(input, { ...init, headers });
 * };
 */
export function forwardedHeaders() {
  return inboundHeaders.getStore() ?? {};
}
