import {
  ApplicationRef,
  Component,
  ComponentRef,
  DestroyRef,
  ElementRef,
  EnvironmentInjector,
  Injector,
  ViewEncapsulation,
  createComponent,
  inject,
  input,
  inputBinding,
  viewChild,
} from "@angular/core";

import { injectChatLabels } from "../../chat-config";
import { explicitEffect } from "../../explicit-effect";
import { CopilotChatCodeBlockHeader } from "./copilot-chat-code-block-header";
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

      /* Inline code styling */
      copilot-chat-assistant-message-renderer code:not(pre code) {
        padding: 2.5px 4.8px;
        background-color: rgb(236, 236, 236);
        border-radius: 0.25rem;
        font-size: 0.875rem;
        font-family:
          ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo,
          monospace;
        font-weight: 500;
        color: #000000;
      }

      .dark copilot-chat-assistant-message-renderer code:not(pre code) {
        background-color: #171717; /* same as code blocks */
        color: rgb(248, 250, 252); /* text-foreground in dark mode */
      }

      /* Code block container */
      copilot-chat-assistant-message-renderer .code-block-container {
        position: relative;
        margin: 0.25rem 0;
        background-color: rgb(249, 249, 249);
        border-radius: 1rem;
      }

      .dark copilot-chat-assistant-message-renderer .code-block-container {
        background-color: #171717;
      }

      copilot-chat-assistant-message-renderer .code-block-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1rem 0.75rem 1rem;
        font-size: 0.75rem;
        background-color: transparent;
      }

      copilot-chat-assistant-message-renderer .code-block-language {
        font-weight: 400;
        color: rgba(115, 115, 115, 1);
      }

      .dark copilot-chat-assistant-message-renderer .code-block-language {
        color: white;
      }

      copilot-chat-assistant-message-renderer .code-block-copy-button {
        display: flex;
        align-items: center;
        gap: 0.125rem;
        padding: 0 0.5rem;
        font-size: 0.75rem;
        color: rgba(115, 115, 115, 1);
        cursor: pointer;
        background: none;
        border: none;
        transition: opacity 0.2s;
      }

      .dark copilot-chat-assistant-message-renderer .code-block-copy-button {
        color: white;
      }

      copilot-chat-assistant-message-renderer .code-block-copy-button:hover {
        opacity: 0.8;
      }

      copilot-chat-assistant-message-renderer .code-block-copy-button svg {
        width: 10px;
        height: 10px;
      }

      copilot-chat-assistant-message-renderer .code-block-copy-button span {
        font-size: 11px;
      }

      copilot-chat-assistant-message-renderer pre {
        margin: 0;
        padding: 0 1rem 1rem 1rem;
        overflow-x: auto;
        background-color: transparent;
        border-radius: 1rem;
      }

      .dark copilot-chat-assistant-message-renderer pre {
        background-color: transparent;
      }

      copilot-chat-assistant-message-renderer pre code {
        background-color: transparent;
        padding: 0;
        font-size: 0.875rem;
        font-family:
          ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo,
          monospace;
      }

      /* Highlight.js theme adjustments */
      copilot-chat-assistant-message-renderer .hljs {
        background: transparent;
        color: rgb(56, 58, 66);
      }

      .dark copilot-chat-assistant-message-renderer .hljs {
        background: transparent;
        color: #abb2bf;
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
  private readonly appRef = inject(ApplicationRef);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly injector = inject(Injector);
  private codeBlockHeaders: ComponentRef<CopilotChatCodeBlockHeader>[] = [];

  constructor() {
    explicitEffect(
      () => ({
        container: this.markdownContainer()?.nativeElement,
        content: this.content(),
      }),
      ({ container, content }) => {
        if (!container) return;
        this.destroyCodeBlockHeaders();
        const rendered = renderMarkdown(content, (code, language) =>
          this.addCodeBlockHeader(code, language),
        );
        // The server DOM has no replaceChildren(); it only gets the text.
        if (typeof rendered === "string") {
          container.textContent = rendered;
        } else {
          container.replaceChildren(rendered);
        }
      },
    );

    inject(DestroyRef).onDestroy(() => this.destroyCodeBlockHeaders());
  }

  /** Wraps a rendered code block and mounts its header component above it. */
  private addCodeBlockHeader(code: HTMLElement, language: string): void {
    const pre = code.parentElement!;
    const container = pre.ownerDocument.createElement("div");
    container.className = "code-block-container";
    pre.replaceWith(container);

    const source = code.textContent ?? "";
    const header = createComponent(CopilotChatCodeBlockHeader, {
      environmentInjector: this.environmentInjector,
      elementInjector: this.injector,
      bindings: [
        inputBinding("language", () => language),
        inputBinding("code", () => source),
      ],
    });
    this.appRef.attachView(header.hostView);
    header.changeDetectorRef.detectChanges();
    this.codeBlockHeaders.push(header);

    container.append(header.location.nativeElement, pre);
  }

  private destroyCodeBlockHeaders(): void {
    this.codeBlockHeaders.forEach((header) => header.destroy());
    this.codeBlockHeaders = [];
  }
}
