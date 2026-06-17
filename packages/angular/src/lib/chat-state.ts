import { inject, Injectable, Signal, WritableSignal } from "@angular/core";

@Injectable()
export abstract class ChatState {
  abstract readonly inputValue: WritableSignal<string>;

  abstract submitInput(value: string): void | Promise<void>;
  abstract changeInput(value: string): void;

  /**
   * Whether the agent is currently running.
   * Optional — components that don't manage a run fall back to `undefined`.
   */
  readonly isRunning?: Signal<boolean>;

  /**
   * Whether a stop action is currently meaningful.
   *
   * Mirrors React v2 `shouldAllowStop = agent.isRunning && hasMessages`:
   * the stop affordance is only active when a run is in flight AND the thread
   * already has at least one message (so clicking Stop on the welcome screen
   * before any message is sent does nothing).
   *
   * Optional — when absent, `CopilotChatInput` falls back to checking whether
   * `stopCurrentRun` is defined (the pre-#5428 behaviour).
   */
  readonly canStopRun?: Signal<boolean>;

  /**
   * Stop the currently active run.
   * Optional — only provided when the chat is wired to a run-aware agent
   * (e.g. `CopilotChat`).
   */
  stopCurrentRun?(): void;
}

export function injectChatState(): ChatState {
  try {
    return inject(ChatState);
  } catch {
    throw new Error(
      "ChatState not found. A parent component must provide ChatState.",
    );
  }
}
