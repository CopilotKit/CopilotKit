import type { Register } from "../register";

// biome-ignore lint/suspicious/noExplicitAny: fallback types need any
type AnyRecord = Record<string, any>;

/**
 * When Register is augmented with `agents`, this resolves to the union of agent ID keys.
 * Otherwise it falls back to `string` for full backward compatibility.
 */
export type AgentId = Register extends {
  agents: infer A extends AnyRecord;
}
  ? keyof A & string
  : string;

/**
 * Tool map for a specific agent.
 * Resolves to the agent's `tools` record when Register is augmented, otherwise falls back to AnyRecord.
 */
type AgentToolMap<A extends string> = Register extends {
  agents: infer Agents extends AnyRecord;
}
  ? A extends keyof Agents
    ? Agents[A] extends { tools: infer T extends AnyRecord }
      ? T
      : AnyRecord
    : AnyRecord
  : AnyRecord;

/**
 * Union of all tools across agents.
 * Falls back to AnyRecord when Register is not augmented.
 */
type AllTools = Register extends { tools: infer T extends AnyRecord }
  ? T
  : AnyRecord;

/**
 * When Register is augmented with `tools`, this resolves to the union of tool name keys.
 * When a specific agent ID is provided, constrains to that agent's tools only.
 * Otherwise it falls back to `string`.
 */
export type ToolName<A extends string | undefined = undefined> =
  undefined extends A
    ? Register extends { tools: infer T extends AnyRecord }
      ? keyof T & string
      : string
    : A extends string
      ? keyof AgentToolMap<A> & string
      : string;

/**
 * Extracts the parameter type for a given tool name.
 * When an agent ID is provided, scopes to that agent's parameter type.
 * Falls back to Record<string, unknown> when Register is not augmented.
 *
 * Note: We inline the Register checks instead of using AllTools/AgentToolMap
 * to avoid an `any` fallback — AnyRecord[T] = any, which would leak to callers.
 */
export type ToolParameters<
  T extends string,
  A extends string | undefined = undefined,
> = undefined extends A
  ? Register extends { tools: infer Tools extends AnyRecord }
    ? T extends keyof Tools
      ? Tools[T]
      : Record<string, unknown>
    : Record<string, unknown>
  : A extends string
    ? Register extends { agents: infer Agents extends AnyRecord }
      ? A extends keyof Agents
        ? Agents[A] extends { tools: infer AT extends AnyRecord }
          ? T extends keyof AT
            ? AT[T]
            : Record<string, unknown>
          : Record<string, unknown>
        : Record<string, unknown>
      : Record<string, unknown>
    : Record<string, unknown>;
