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
