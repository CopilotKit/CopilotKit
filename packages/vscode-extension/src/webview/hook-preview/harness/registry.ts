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
  /** All render-tool-call entries (from `useCopilotAction`, `useRenderTool`, ...). */
  renderToolCalls: Array<{ name: string; [key: string]: unknown }>;
  /** V2 tools (metadata + optional render). */
  tools: Array<{ name: string; [key: string]: unknown }>;
  /** V1 co-agent state renderers (from `useCoAgentStateRender`). */
  coAgentStateRenders: Array<{ name?: string; [key: string]: unknown }>;
  /** V1 chat-component cache (`<CopilotKit>` keeps this on context). */
  chatComponents: unknown;
}
