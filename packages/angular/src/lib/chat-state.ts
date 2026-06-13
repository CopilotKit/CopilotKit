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
