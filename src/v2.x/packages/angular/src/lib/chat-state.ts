import { inject, Injectable, WritableSignal } from "@angular/core";

@Injectable()
export abstract class ChatState {
  abstract readonly inputValue: WritableSignal<string>;

  abstract submitInput(value: string): void;
  abstract changeInput(value: string): void;
}

export function injectChatState(): ChatState {
  try {
    return inject(ChatState);
  } catch {
    throw new Error(
      "ChatState not found. A parent component must provide ChatState."
    );
  }
}
