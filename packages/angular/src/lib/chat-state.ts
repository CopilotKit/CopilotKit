import {
  inject,
  Injectable,
  Signal,
  signal,
  WritableSignal,
} from "@angular/core";
import type { Attachment } from "@copilotkit/shared";
import type { Suggestion } from "@copilotkit/core";

@Injectable()
export abstract class ChatState {
  abstract readonly inputValue: WritableSignal<string>;
  readonly attachments = signal<Attachment[]>([]);
  readonly attachmentsEnabled: Signal<boolean> = signal(false);
  readonly attachmentsUploading: Signal<boolean> = signal(false);
  readonly dragOver = signal(false);
  readonly suggestions = signal<Suggestion[]>([]);
  readonly suggestionsLoading = signal(false);
  readonly isTranscribing = signal(false);
  /** True while the agent behind this chat has a run in flight. */
  readonly isRunning: Signal<boolean> = signal(false);
  /** True when the input should offer Stop instead of Send. */
  readonly canStop: Signal<boolean> = signal(false);

  abstract submitInput(value: string): void;
  abstract changeInput(value: string): void;
  /** Stops the in-flight run. A no-op for chat states without run control. */
  stopRun(): void {}
  selectSuggestion(_suggestion: Suggestion, _index: number): void {}
  finishTranscription(_audioBlob: Blob): void | Promise<void> {}

  addFile(): void {}
  removeAttachment(_id: string): void {}
  handleDragOver(_event: DragEvent): void {}
  handleDragLeave(_event: DragEvent): void {}
  handleDrop(_event: DragEvent): void {}
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
