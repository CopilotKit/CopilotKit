import {
  Component,
  ElementRef,
  ViewEncapsulation,
  input,
  viewChild,
} from "@angular/core";

import { injectChatLabels } from "../../chat-config";
import { explicitEffect } from "../../explicit-effect";
import { renderMarkdown } from "./markdown";

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
  readonly inputClass = input<string | undefined>();
  readonly labels = injectChatLabels();

  private readonly markdownContainer =
    viewChild<ElementRef<HTMLDivElement>>("markdownContainer");

  constructor() {
    explicitEffect(
      () => ({
        container: this.markdownContainer()?.nativeElement,
        content: this.content(),
      }),
      ({ container, content }) => {
        if (!container) return;
        const rendered = renderMarkdown(content);
        // The server DOM has no replaceChildren(); it only gets the text.
        if (typeof rendered === "string") {
          container.textContent = rendered;
        } else {
          container.replaceChildren(rendered);
        }
      },
    );
  }
}
