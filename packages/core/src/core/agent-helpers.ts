import type { AbstractAgent } from "@ag-ui/client";
import type { AgentCapabilities } from "@ag-ui/core";

/** A value that survives `JSON.stringify` unchanged in meaning. */
export type ɵJsonSerializable =
  | string
  | number
  | boolean
  | null
  | ɵJsonSerializable[]
  | { [key: string]: ɵJsonSerializable };

/** Agent context as app code gives it: any value, not only a string. */
export interface ɵAgentContextInput {
  /** A human-readable description of what this context represents. */
  description: string;
  /**
   * The context value. A string is sent as-is; any other value is sent as its
   * JSON text, so it should be JSON-serializable (an interface type or an
   * optional field is fine).
   */
  value: unknown;
}

/**
 * The string the agent receives for a context value: a string as-is,
 * anything else as JSON. A value JSON has no text for (`undefined`, a
 * function) becomes its `String()` form.
 */
export function ɵserializeContextValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

/**
 * The capabilities an agent declares, filled from the runtime `/info`
 * response. `undefined` until the runtime handshake lands, when the agent
 * declares none, or when there is no agent yet (a Vue ref before resolution).
 */
export function ɵgetAgentCapabilities(agent: AbstractAgent | null | undefined) {
  if (!agent || !declaresCapabilities(agent)) return undefined;
  return agent.capabilities;
}

function declaresCapabilities(
  agent: AbstractAgent,
): agent is AbstractAgent & { capabilities?: AgentCapabilities } {
  return "capabilities" in agent;
}
