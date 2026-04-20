import { Fragment, createElement, type ReactNode } from "react";

/**
 * Runtime stub for `@copilotkit/react-core` (and `@copilotkit/react-core/v2`).
 *
 * We make the real module external at bundle time and resolve its imports
 * to this Proxy-backed stub at webview runtime. The stubs capture every hook
 * config into `window.__copilotkit_captured` and render every component as a
 * no-op Fragment. This lets us preview a user's hook render function without
 * pulling in the entire chat/runtime-client/markdown dep graph — which was
 * where the TDZ errors (require_clipboard, require_graphql, …) originated.
 *
 * Trade-off: the user's component is only "called," not fully mounted against
 * a real CopilotKit runtime. Hook-level behavior that depends on real context
 * (e.g. useCopilotChat returning live messages) is unavailable here — if a
 * preview needs that, add a specific stub return value below rather than
 * leaning on the Proxy fallback.
 */

export interface CapturedHookCall {
  hook: string;
  config: unknown;
}

declare global {
  interface Window {
    __copilotkit_captured?: CapturedHookCall[];
  }
}

function ensureCapturedRegistry(): CapturedHookCall[] {
  if (!window.__copilotkit_captured) window.__copilotkit_captured = [];
  return window.__copilotkit_captured;
}

function captureHook(hookName: string) {
  return (config: unknown) => {
    ensureCapturedRegistry().push({ hook: hookName, config });
  };
}

// Components that must render children through (user source likely wraps
// other UI in these). Everything else rendered by the stub is a null element.
const PASS_THROUGH_COMPONENTS = new Set([
  "CopilotKit",
  "CopilotKitProvider",
]);

function stubComponent(name: string) {
  if (PASS_THROUGH_COMPONENTS.has(name)) {
    return ({ children }: { children?: ReactNode }) =>
      createElement(Fragment, null, children);
  }
  return () => null;
}

const KNOWN_HOOKS = new Set([
  "useCopilotAction",
  "useCoAgent",
  "useCoAgentStateRender",
  "useCopilotAdditionalInstructions",
  "useCopilotChat",
  "useCopilotChatSuggestions",
  "useCopilotContext",
  "useCopilotImperativeChat",
  "useCopilotReadable",
  "useLangGraphInterrupt",
  "useRenderTool",
  "useRenderToolCall",
  "useFrontendTool",
  "useToolCall",
  "useToolRenderer",
  "useLazyToolRenderer",
]);

/**
 * Build a Proxy whose property getter returns:
 *   - a capturing noop for any known hook name
 *   - a null-render component for any capitalized name
 *   - a plain noop for anything else
 * This covers the vast majority of imports from `@copilotkit/react-core`
 * without us having to exhaustively enumerate every export.
 */
export function createCopilotkitStubs(): Record<string, unknown> {
  const cache: Record<string, unknown> = {};
  return new Proxy(cache, {
    get(target, prop) {
      if (typeof prop !== "string") return Reflect.get(target, prop);
      if (prop in target) return target[prop];
      let value: unknown;
      if (KNOWN_HOOKS.has(prop) || /^use[A-Z]/.test(prop)) {
        value = captureHook(prop);
      } else if (/^[A-Z]/.test(prop)) {
        value = stubComponent(prop);
      } else {
        value = () => undefined;
      }
      target[prop] = value;
      return value;
    },
    // Rolldown sometimes uses `has` (e.g. `prop in ns`) — always answer yes so
    // the IIFE never tries to fall through to another resolution.
    has() {
      return true;
    },
  });
}
