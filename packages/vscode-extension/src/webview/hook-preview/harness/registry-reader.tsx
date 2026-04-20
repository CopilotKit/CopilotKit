import { useEffect } from "react";
import type { CapturedRegistry } from "./registry";
import type { CapturedHookCall } from "../copilotkit-stubs";

/**
 * Reads the capture array populated by the runtime stubs
 * (see `../copilotkit-stubs.ts`) and shapes it into the
 * `CapturedRegistry` layout the rest of the preview consumes.
 *
 * Fires after the host tree has rendered once — the useEffect timing
 * guarantees every hook call inside HostRoot has pushed its config to
 * `window.__copilotkit_captured` before we read it.
 */
export function RegistryReader({
  onCapture,
}: {
  onCapture: (reg: CapturedRegistry) => void;
}) {
  useEffect(() => {
    const captured: CapturedHookCall[] =
      (window as unknown as { __copilotkit_captured?: CapturedHookCall[] })
        .__copilotkit_captured ?? [];
    const registry = buildRegistry(captured);
    onCapture(registry);
    // `onCapture` is stable from App.tsx (setRegistry).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCapture]);

  return null;
}

/** Hook names whose configs go into the `renderToolCalls` slot. */
const RENDER_TOOL_CALL_HOOKS = new Set([
  "useCopilotAction",
  "useRenderToolCall",
  "useRenderTool",
  "useFrontendTool",
  "useLazyToolRenderer",
]);

/** Hook names whose configs go into the `tools` slot. */
const TOOL_HOOKS = new Set(["useToolCall", "useToolRenderer"]);

export function buildRegistry(
  captured: ReadonlyArray<CapturedHookCall>,
): CapturedRegistry {
  const renderToolCalls: CapturedRegistry["renderToolCalls"] = [];
  const tools: CapturedRegistry["tools"] = [];
  const coAgentStateRenders: CapturedRegistry["coAgentStateRenders"] = [];

  for (const { hook, config } of captured) {
    const c = (config ?? {}) as Record<string, unknown>;
    if (RENDER_TOOL_CALL_HOOKS.has(hook)) {
      renderToolCalls.push({ ...c, name: String(c.name ?? "") });
    } else if (TOOL_HOOKS.has(hook)) {
      tools.push({ ...c, name: String(c.name ?? "") });
    } else if (hook === "useCoAgentStateRender") {
      coAgentStateRenders.push({ ...c });
    } else if (hook === "useLangGraphInterrupt") {
      // Interrupts don't have a distinct slot in CapturedRegistry yet; they
      // fall through today. Surface via renderToolCalls with a synthetic
      // name so the UI can at least list them.
      renderToolCalls.push({
        ...c,
        name: String(c.name ?? "__langgraph_interrupt__"),
      });
    }
  }

  return {
    renderToolCalls,
    tools,
    coAgentStateRenders,
    chatComponents: null,
  };
}
