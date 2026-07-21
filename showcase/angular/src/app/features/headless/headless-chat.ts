import { DestroyRef, computed, inject, signal } from "@angular/core";
import { CopilotKit, injectAgentStore } from "@copilotkit/angular";

import type { ShowcaseMessage } from "./headless-chat.types";

/** Signal-first controller shared by the two native Angular headless demos. */
export abstract class HeadlessChatController {
  private readonly copilotKit = inject(CopilotKit);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly agentStore = injectAgentStore("default");
  protected readonly inputValue = signal("");
  protected readonly error = signal<string | null>(null);
  protected readonly messages = computed(
    () => this.agentStore().messages() as ShowcaseMessage[],
  );
  protected readonly isRunning = computed(() => this.agentStore().isRunning());

  protected updateInput(event: Event): void {
    this.inputValue.set((event.target as HTMLTextAreaElement).value);
  }

  protected handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void this.send();
  }

  protected async send(override?: string): Promise<void> {
    const text = (override ?? this.inputValue()).trim();
    if (!text || this.isRunning()) return;

    this.error.set(null);
    const agent = this.agentStore().agent;
    const message = {
      id: createMessageId(),
      role: "user" as const,
      content: text,
    };
    agent.addMessage(message);
    this.inputValue.set("");

    try {
      await this.copilotKit.core.runAgent({ agent });
    } catch (error) {
      if (this.destroyRef.destroyed) return;
      console.error("[showcase-angular:headless] Agent run failed", error);
      this.error.set(
        error instanceof Error ? error.message : "The agent run failed.",
      );
    }
  }
}

function createMessageId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `angular-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
