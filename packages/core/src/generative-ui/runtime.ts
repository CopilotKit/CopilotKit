import type {
  GenerativeUI,
  GenerativeUIErrorInfo,
  GenerativeUIInvokeResult,
} from "@copilotkit/shared/generative-ui";
import type { GenerativeUIUserEvent } from "@copilotkit/shared";
import type { GenerativeUIDispatcher } from "./dispatcher";
import type { GenerativeUISurfaceManager } from "./surface-manager";

/**
 * What the engine needs from the runtime of a framework: the surfaces, the
 * function dispatcher, and how user events and errors leave the UI. A
 * framework's runtime object satisfies it structurally and adds its own
 * config and theme on top.
 */
export interface GenerativeUIEngine {
  manager: GenerativeUISurfaceManager;
  dispatcher: GenerativeUIDispatcher;
  /** The generative UI given to the provider. */
  ui: GenerativeUI;
  forwardEvent: (
    event: GenerativeUIUserEvent,
    agentId: string | undefined,
  ) => Promise<GenerativeUIInvokeResult>;
  reportError: (info: GenerativeUIErrorInfo) => void;
}

/**
 * Reports an error without ever throwing: `reportError` reaches host code
 * (`onError`), and a throwing host callback must not break rendering or an
 * event handler.
 */
export function reportErrorSafely(
  engine: Pick<GenerativeUIEngine, "reportError">,
  info: GenerativeUIErrorInfo,
): void {
  try {
    engine.reportError(info);
  } catch {
    // Intentionally swallowed: there is nowhere safe left to report to.
  }
}
