import type { ReactNode } from "react";

/** Generic render-function signature — specific adapters cast to their
 * narrower prop shape when invoking (see `adapters/*.ts`). */
export type CapturedRenderFn = (props: unknown) => ReactNode;

/** A render-tool-call entry as observed in V2's internal registry. */
export interface CapturedRenderToolCall {
  name: string;
  render?: CapturedRenderFn;
  /** Optional Standard-Schema v1 or V1 parameters array. */
  parameters?: unknown;
  agentId?: string;
  [key: string]: unknown;
}

/** A V2 tool entry. Same shape as a render-tool-call without the render. */
export interface CapturedTool {
  name: string;
  render?: CapturedRenderFn;
  parameters?: unknown;
  agentId?: string;
  [key: string]: unknown;
}

/** A V1 co-agent state renderer registered by `useCoAgentStateRender`. */
export interface CapturedCoAgentStateRender {
  name?: string;
  nodeName?: string;
  render?: CapturedRenderFn;
  [key: string]: unknown;
}

/**
 * A snapshot of the render-carrying items registered inside a mounted
 * CopilotKit tree at the moment the `RegistryReader`'s effect fires.
 *
 * In current react-core, both V1 `useCopilotAction` and V2 `useRenderTool` /
 * `useRenderToolCall` / `useFrontendTool` register into the same internal V2
 * registry. Consumers look up a captured config by hook name + identity:
 *
 * - For render-tool-shaped hooks (action, human-in-the-loop, render-tool,
 *   frontend-tool): search `renderToolCalls` by `name`.
 * - For coagent-state-shaped hooks: search `coAgentStateRenders` by `name`.
 * - For interrupt-shaped hooks: TBD — current V2 exposure is partial; MVP
 *   previews of interrupt renders may need a follow-up.
 */
export interface CapturedRegistry {
  renderToolCalls: CapturedRenderToolCall[];
  tools: CapturedTool[];
  coAgentStateRenders: CapturedCoAgentStateRender[];
  /** V1 chat-component cache (`<CopilotKit>` keeps this on context). */
  chatComponents: unknown;
}
