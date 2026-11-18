import { InjectionToken } from "@angular/core";
import type { Signal } from "@angular/core";

/**
 * The run state the chat input needs for its stop button. `CopilotChat`
 * provides it. Without a provider, the input never shows stop.
 * @internal
 */
export interface ChatRunControl {
  /** `true` while the agent runs. */
  readonly isRunning: Signal<boolean>;
  /** `true` when `stop()` can stop the run: it runs and has messages. */
  readonly canStop: Signal<boolean>;
  /** Stop the agent's current run. */
  stop(): void;
}

/** @internal */
export const COPILOT_CHAT_RUN_CONTROL = new InjectionToken<ChatRunControl>(
  "COPILOT_CHAT_RUN_CONTROL",
);
