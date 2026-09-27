import type { AfterViewInit } from "@angular/core";
import {
  Component,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  computed,
  inject,
  ElementRef,
  ViewChild,
} from "@angular/core";

import { Marked } from "marked";
import hljs from "highlight.js";
import * as katex from "katex";
import { completePartialMarkdown } from "@copilotkit/core";
import { copyToClipboard } from "@copilotkit/shared";
import { injectChatLabels } from "../../chat-config";
import { explicitEffect } from "../../explicit-effect";
import { markCursorAnchor } from "./streaming-cursor";

const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/|\.{1,2}\/|[^:]*$)/i;
const SAFE_IMAGE_URL = /^(?:https?:|data:image\/|\/|\.{1,2}\/|[^:]*$)/i;

/**
 * What a browser would read as the URL: character references decoded and the
 * whitespace / control characters it ignores inside a scheme removed.
 */
function normalizeUrl(href: string): string {
  return href
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&colon;?/gi, ":")
    .replace(/&(tab|newline);?/gi, "")
    .replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
}

/** Neutralize link / image URLs with script-capable schemes (javascript:, vbscript:, ...). */
function sanitizeTokenUrl(token: { type: string; href?: string }): void {
  if (typeof token.href !== "string") return;
  const href = normalizeUrl(token.href);
  if (token.type === "link" && !SAFE_URL.test(href)) token.href = "#";
  if (token.type === "image" && !SAFE_IMAGE_URL.test(href)) token.href = "";
}

function processMathEquationsInHtml(html: string): string {
  // First, temporarily replace code blocks with placeholders to protect them from math processing
  const codeBlocks: string[] = [];
  const placeholder = "___CODE_BLOCK_PLACEHOLDER_";

  // Store code blocks and replace with placeholders
  html = html.replace(/<pre><code[\s\S]*?<\/code><\/pre>/g, (match) => {
    const index = codeBlocks.length;
    codeBlocks.push(match);
    return `${placeholder}${index}___`;
  });

  // Also protect inline code
  const inlineCode: string[] = [];
  const inlinePlaceholder = "___INLINE_CODE_PLACEHOLDER_";
  html = html.replace(/<code>[\s\S]*?<\/code>/g, (match) => {
    const index = inlineCode.length;
    inlineCode.push(match);
    return `${inlinePlaceholder}${index}___`;
  });

  // Process display math $$ ... $$
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (match, equation) => {
    try {
      return katex.renderToString(equation, {
        displayMode: true,
        throwOnError: false,
      });
    } catch {
      return match;
    }
  });

  // A closing inline-math delimiter cannot be preceded by whitespace or
  // followed by a digit. Those delimiter rules keep ordinary currency ranges
  // such as "$349 ... $289" from becoming one large KaTeX expression.
  html = html.replace(
    /(?<!\\)\$(?!\s)([^$\n]*?\S)\$(?!\d)/g,
    (match, equation) => {
      try {
        return katex.renderToString(equation, {
          displayMode: false,
          throwOnError: false,
        });
      } catch {
        return match;
      }
    },
  );

  // Restore code blocks
  codeBlocks.forEach((block, index) => {
    html = html.replace(`${placeholder}${index}___`, block);
  });

  // Restore inline code
  inlineCode.forEach((code, index) => {
    html = html.replace(`${inlinePlaceholder}${index}___`, code);
  });

  return html;
}

@Component({
  standalone: true,
  selector: "copilot-chat-assistant-message-renderer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div
      #markdownContainer
      [class]="inputClass()"
      (click)="handleClick($event)"
    ></div>
  `,
  styles: [
    `
      copilot-chat-assistant-message-renderer {
        display: block;
        width: 100%;
      }

      /* The message or user bubble owns the outer spacing; this also beats
         the code block's own margin when it opens or closes the message. */
      copilot-chat-assistant-message-renderer > div > :first-child {
        margin-top: 0;
      }

      copilot-chat-assistant-message-renderer > div > :last-child {
        margin-bottom: 0;
      }

      /* Inline code. Colors come from CopilotKit's tokens so the pill reads
         in light and dark. */
      copilot-chat-assistant-message-renderer code:not(pre code) {
        padding: 0.15em 0.4em;
        /* A translucent tint (not --muted) so inline code stays visible on any
           surface, including the muted user-message bubble. */
        background-color: color-mix(in oklab, var(--foreground) 9%, transparent);
        border-radius: calc(var(--radius) - 4px);
        font-size: 0.875em;
        font-family:
          ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo,
          monospace;
        font-weight: 500;
        color: var(--foreground);
      }

      /* Code block container: a raised surface that follows the theme. */
      copilot-chat-assistant-message-renderer .code-block-container {
        position: relative;
        margin: 1em 0;
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: calc(var(--radius) + 4px);
        background-color: color-mix(in oklab, var(--muted) 50%, var(--background));
      }

      .dark copilot-chat-assistant-message-renderer .code-block-container {
        background-color: var(--card);
      }

      copilot-chat-assistant-message-renderer .code-block-header {
        display: flex;
        height: 2.25rem;
        align-items: center;
        justify-content: space-between;
        padding: 0 0.5rem 0 0.75rem;
        border-bottom: 1px solid var(--border);
        font-family:
          ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo,
          monospace;
        font-size: 0.75rem;
        color: var(--muted-foreground);
        background-color: transparent;
      }

      copilot-chat-assistant-message-renderer .code-block-language {
        font-weight: 400;
        color: var(--muted-foreground);
      }

      copilot-chat-assistant-message-renderer .code-block-copy-button {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        height: 1.625rem;
        padding: 0 0.5rem;
        border: none;
        border-radius: calc(var(--radius) - 4px);
        font-size: 0.75rem;
        color: var(--muted-foreground);
        background: none;
        cursor: pointer;
        transition:
          color 150ms,
          background-color 150ms;
      }

      copilot-chat-assistant-message-renderer .code-block-copy-button:hover {
        color: var(--foreground);
        background-color: var(--accent);
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
        padding: 0.875rem 1rem;
        overflow-x: auto;
        color: var(--foreground);
        background-color: transparent;
        border-radius: 0;
      }

      copilot-chat-assistant-message-renderer pre code {
        background-color: transparent;
        padding: 0;
        font-size: 0.8125rem;
        line-height: 1.6;
        font-family:
          ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo,
          monospace;
      }

      /* Highlight.js: plain tokens use the foreground; the syntax palette
         (Atom One light/dark) lives with CopilotChatAssistantMessage. */
      copilot-chat-assistant-message-renderer .hljs {
        background: transparent;
        color: var(--foreground);
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
export class CopilotChatAssistantMessageRenderer implements AfterViewInit {
  readonly content = input<string>("");
  readonly inputClass = input<string | undefined>();
  /** Render markdown headings as plain paragraphs (used for user messages). */
  readonly plainHeadings = input<boolean>(false);
  readonly labels = injectChatLabels();

  @ViewChild("markdownContainer", { static: false })
  markdownContainer?: ElementRef<HTMLDivElement>;

  private elementRef = inject(ElementRef);

  // Track copy states for code blocks (DOM-updated; no signal needed)
  private copyStates = new Map<string, boolean>();

  readonly renderedHtml = computed(() => {
    this.plainHeadings();
    const currentContent = this.content();
    const completedMarkdown = completePartialMarkdown(currentContent);
    return this.renderMarkdown(completedMarkdown);
  });

  constructor() {
    explicitEffect(this.content, () => {
      // Reset copy states when content changes
      this.copyStates.clear();
      // If view is ready, update DOM
      if (this.markdownContainer) {
        this.updateContent();
        this.renderMathEquations();
      }
    });
  }

  ngAfterViewInit(): void {
    this.updateContent();
    this.renderMathEquations();
  }

  private updateContent(): void {
    if (!this.markdownContainer) return;
    const container = this.markdownContainer.nativeElement;
    const html = this.renderedHtml();
    container.innerHTML = html;
    // Where the streaming cursor rides (shown only while the reply streams).
    markCursorAnchor(container);
  }

  private codeBlocksMap = new Map<string, string>();
  private markedInstance: Marked | null = null;

  private initializeMarked(): void {
    if (this.markedInstance) return;

    // Store highlighted code blocks temporarily
    const highlightedBlocks = new Map<string, string>();

    // Create a new Marked instance
    this.markedInstance = new Marked();

    // Configure marked options
    this.markedInstance.setOptions({
      gfm: true,
      breaks: true,
    });

    this.markedInstance.use({
      renderer: {
        // `false` falls back to marked's default heading renderer.
        heading: (text: string) =>
          this.plainHeadings() ? `<p>${text}</p>\n` : false,
      },
    });

    // Add a walkTokens function to process code tokens before rendering
    this.markedInstance.use({
      walkTokens: (token: any) => {
        if (token.type === "link" || token.type === "image") {
          sanitizeTokenUrl(token);
        }
        if (token.type === "code") {
          const rawCode = token.text;
          const lang = token.lang || "";

          const blockId = this.generateBlockId(rawCode);
          // Store the raw code in our map for copying
          this.codeBlocksMap.set(blockId, rawCode);

          const copyLabel = this.labels.assistantMessageToolbarCopyCodeLabel;

          // Manually highlight the code
          const language = hljs.getLanguage(lang) ? lang : "plaintext";
          const highlighted = hljs.highlight(rawCode, { language }).value;
          const codeClass = lang ? `hljs language-${lang}` : "hljs";

          // Create the full HTML with header and highlighted code
          const fullHtml = `
            <div class="code-block-container">
              <div class="code-block-header">
                ${lang ? `<span class="code-block-language">${lang}</span>` : "<span></span>"}
                <button 
                  class="code-block-copy-button" 
                  data-code-block-id="${blockId}"
                  aria-label="${copyLabel} code">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.11 0-2-.9-2-2V4c0-1.11.89-2 2-2h10c1.11 0 2 .89 2 2"/></svg>
                  <span>${copyLabel}</span>
                </button>
              </div>
              <pre><code class="${codeClass}">${highlighted}</code></pre>
            </div>
          `;

          // Store the highlighted HTML
          highlightedBlocks.set(blockId, fullHtml);

          // Change the token to an html token to bypass marked's escaping
          token.type = "html";
          token.text = fullHtml;
        }
      },
    });
  }

  private renderMarkdown(content: string): string {
    // Initialize marked if not already done
    this.initializeMarked();

    // Clear the code blocks map for new render
    this.codeBlocksMap.clear();

    // Parse markdown. Tables get a wrapper that frames them and scrolls
    // sideways when they are wider than the message.
    let html = (this.markedInstance!.parse(content) as string)
      .replace(/<table>/g, '<div class="cpk-md-table"><table>')
      .replace(/<\/table>/g, "</table></div>");

    // Process math equations
    html = processMathEquationsInHtml(html);

    return html;
  }

  private renderMathEquations(): void {
    if (!this.markdownContainer) return;

    const container = this.markdownContainer.nativeElement;

    // Find all math placeholders and render them
    const mathElements = container.querySelectorAll(".math-placeholder");
    mathElements.forEach((element) => {
      const equation = element.getAttribute("data-equation");
      const displayMode = element.getAttribute("data-display") === "true";

      if (equation) {
        try {
          katex.render(equation, element as HTMLElement, {
            displayMode,
            throwOnError: false,
          });
        } catch (error) {
          console.error("Failed to render math equation:", error);
        }
      }
    });
  }

  handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;

    // Check if clicked on copy button or its children
    const copyButton = target.closest(
      ".code-block-copy-button",
    ) as HTMLButtonElement;
    if (copyButton) {
      event.preventDefault();
      const blockId = copyButton.getAttribute("data-code-block-id");

      if (blockId) {
        // Get the raw code from our map instead of from DOM
        const code = this.codeBlocksMap.get(blockId);
        if (code) {
          this.copyCodeBlock(blockId, code);
        }
      }
    }
  }

  private copyCodeBlock(blockId: string, code: string): void {
    copyToClipboard(code).then((success) => {
      if (!success) return;

      // Update the button in the DOM
      const button = this.elementRef.nativeElement.querySelector(
        `[data-code-block-id="${blockId}"]`,
      );
      if (button) {
        const originalHTML = button.innerHTML;
        button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            <span>${this.labels.assistantMessageToolbarCopyCodeCopiedLabel}</span>
          `;
        button.setAttribute(
          "aria-label",
          `${this.labels.assistantMessageToolbarCopyCodeCopiedLabel} code`,
        );

        // Reset after 2 seconds
        setTimeout(() => {
          button.innerHTML = originalHTML;
          button.setAttribute(
            "aria-label",
            `${this.labels.assistantMessageToolbarCopyCodeLabel} code`,
          );
        }, 2000);
      }
    });
  }

  private generateBlockId(code: string): string {
    // Simple hash function for generating unique IDs
    let hash = 0;
    for (let i = 0; i < code.length; i++) {
      const char = code.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `code-block-${hash}`;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
