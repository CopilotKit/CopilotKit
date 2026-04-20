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

/**
 * Hook names whose configs go into the `renderToolCalls` slot — any hook
 * whose render receives args/parameters/status/result. Covers V1 actions,
 * V2 render-tool variants, HITL, and the authenticated-action variant.
 */
const RENDER_TOOL_CALL_HOOKS = new Set([
  "useCopilotAction",
  "useCopilotAuthenticatedAction_c",
  "useRenderToolCall",
  "useRenderTool",
  "useFrontendTool",
  "useLazyToolRenderer",
  "useDefaultRenderTool",
  "useHumanInTheLoop",
  "useComponent",
  "useDefaultTool",
]);

/** Hook names whose configs go into the `tools` slot. */
const TOOL_HOOKS = new Set(["useToolCall", "useToolRenderer"]);

/**
 * Interrupt-kind hooks. They're nameless; we surface them via renderToolCalls
 * with a synthetic name and `findConfig` falls back to `byHook` when the
 * selection has no name.
 */
const INTERRUPT_HOOKS = new Set(["useLangGraphInterrupt", "useInterrupt"]);

/**
 * Message-shape hooks (custom / activity). Nameless and render a message
 * payload. Also surfaced through renderToolCalls + byHook fallback so the
 * single-entry lookup in findConfig works.
 */
const MESSAGE_HOOKS = new Set([
  "useRenderCustomMessages",
  "useRenderActivityMessage",
]);

export function buildRegistry(
  captured: ReadonlyArray<CapturedHookCall>,
): CapturedRegistry {
  const renderToolCalls: CapturedRegistry["renderToolCalls"] = [];
  const tools: CapturedRegistry["tools"] = [];
  const coAgentStateRenders: CapturedRegistry["coAgentStateRenders"] = [];
  const byHook: Record<string, unknown[]> = {};

  for (const { hook, config } of captured) {
    const c = (config ?? {}) as Record<string, unknown>;
    (byHook[hook] ??= []).push(c);

    if (RENDER_TOOL_CALL_HOOKS.has(hook)) {
      renderToolCalls.push({ ...c, name: String(c.name ?? "") });
    } else if (TOOL_HOOKS.has(hook)) {
      tools.push({ ...c, name: String(c.name ?? "") });
    } else if (hook === "useCoAgentStateRender") {
      coAgentStateRenders.push({ ...c });
    } else if (INTERRUPT_HOOKS.has(hook)) {
      // Nameless — synthesize a stable name so list-by-name UIs have
      // something to show. Actual lookup flows through `byHook`.
      renderToolCalls.push({
        ...c,
        name: String(c.name ?? `__${hook}__`),
      });
    } else if (MESSAGE_HOOKS.has(hook)) {
      renderToolCalls.push({
        ...c,
        name: String(c.name ?? `__${hook}__`),
      });
    }
  }

  return {
    renderToolCalls,
    tools,
    coAgentStateRenders,
    byHook,
    chatComponents: null,
  };
}
