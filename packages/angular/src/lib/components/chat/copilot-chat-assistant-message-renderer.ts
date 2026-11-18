import {
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  inject,
  input,
  viewChild,
} from "@angular/core";

import { injectChatLabels } from "../../chat-config";
import { explicitEffect } from "../../explicit-effect";
import { createAssistantMarkdownRenderer } from "./markdown";

@Component({
  selector: "copilot-chat-assistant-message-renderer",
  encapsulation: ViewEncapsulation.None,
  template: `
    <div #markdownContainer [class]="inputClass()"></div>
  `,
  styles: [
    `
      copilot-chat-assistant-message-renderer {
        display: block;
        width: 100%;
      }

      /* Math equations */
      copilot-chat-assistant-message-renderer .katex-display {
        overflow-x: auto;
        overflow-y: hidden;
        padding: 1rem 0;
      }
    `,
  ],
})
export class CopilotChatAssistantMessageRenderer {
  readonly content = input<string>("");
  /** True while this message is still streaming: shows the caret. */
  readonly isStreaming = input<boolean>(false);
  readonly inputClass = input<string | undefined>();
  readonly labels = injectChatLabels();

  private readonly markdownContainer =
    viewChild<ElementRef<HTMLDivElement>>("markdownContainer");

  constructor() {
    let renderer: ReturnType<typeof createAssistantMarkdownRenderer> | null =
      null;
    inject(DestroyRef).onDestroy(() => renderer?.destroy());

    explicitEffect(
      () => ({
        container: this.markdownContainer()?.nativeElement,
        content: this.content(),
        isStreaming: this.isStreaming(),
      }),
      ({ container, content, isStreaming }) => {
        if (!container) return;
        renderer ??= createAssistantMarkdownRenderer(container);
        renderer.render({ content, isStreaming });
      },
    );
  }
}
