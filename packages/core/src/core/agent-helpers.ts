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

/** Agent context as app code gives it: any JSON value, not only a string. */
export interface ɵAgentContextInput {
  /** A human-readable description of what this context represents. */
  description: string;
  /** The context value. A non-string value is sent as its JSON text. */
  value: ɵJsonSerializable;
}

/**
 * The string the agent receives for a context value: a string as-is,
 * anything else as JSON.
 */
export function ɵserializeContextValue(value: ɵJsonSerializable) {
  return typeof value === "string" ? value : JSON.stringify(value);
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
