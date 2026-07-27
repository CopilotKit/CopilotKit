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

  abstract submitInput(value: string): void;
  abstract changeInput(value: string): void;
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
