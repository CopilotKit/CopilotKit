import { Injectable, signal } from "@angular/core";
import { ChatState } from "@copilotkit/angular";

/** In-memory `ChatState` for stories that render chat components without `CopilotChat`. */
@Injectable()
export class StoryChatState extends ChatState {
  readonly inputValue = signal<string>("");

  submitInput(value: string): void {
    const trimmed = value.trim();
    if (!trimmed) return;
    console.log("[Storybook] submitInput", trimmed);
    this.inputValue.set("");
  }

  changeInput(value: string): void {
    this.inputValue.set(value);
  }
}
