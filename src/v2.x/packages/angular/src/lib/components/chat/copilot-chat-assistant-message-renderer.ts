import {
  Component,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  ElementRef,
  AfterViewInit,
  ViewChild,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { Marked } from "marked";
import hljs from "highlight.js";
import * as katex from "katex";
import { completePartialMarkdown } from "@copilotkitnext/core";
import { LucideAngularModule } from "lucide-angular";
import { injectChatLabels } from "../../chat-config";

@Component({
  standalone: true,
  selector: "copilot-chat-assistant-message-renderer",
  imports: [CommonModule, LucideAngularModule],
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

      /* Inline code styling */
      copilot-chat-assistant-message-renderer code:not(pre code) {
        padding: 2.5px 4.8px;
        background-color: rgb(236, 236, 236);
        border-radius: 0.25rem;
        font-size: 0.875rem;
        font-family:
          ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono",
          Menlo, monospace;
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
          ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono",
          Menlo, monospace;
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
export class CopilotChatAssistantMessageRenderer implements AfterViewInit {
  readonly content = input<string>("");
  readonly inputClass = input<string | undefined>();
  readonly labels = injectChatLabels();

  @ViewChild("markdownContainer", { static: false })
  markdownContainer?: ElementRef<HTMLDivElement>;

  private elementRef = inject(ElementRef);

  // Track copy states for code blocks (DOM-updated; no signal needed)
  private copyStates = new Map<string, boolean>();

  readonly renderedHtml = computed(() => {
    const currentContent = this.content();
    const completedMarkdown = completePartialMarkdown(currentContent);
    return this.renderMarkdown(completedMarkdown);
  });

  constructor() {
    // React to content changes using signals
    effect(() => {
      // Read content to establish dependency
      this.content();
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

    // Add a walkTokens function to process code tokens before rendering
    this.markedInstance.use({
      walkTokens: (token: any) => {
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

    // Parse markdown
    let html = this.markedInstance!.parse(content) as string;

    // Process math equations
    html = this.processMathEquations(html);

    return html;
  }

  private processMathEquations(html: string): string {
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

    // Process inline math $ ... $
    html = html.replace(/\$([^$]+)\$/g, (match, equation) => {
      try {
        return katex.renderToString(equation, {
          displayMode: false,
          throwOnError: false,
        });
      } catch {
        return match;
      }
    });

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
      ".code-block-copy-button"
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
    navigator.clipboard.writeText(code).then(
      () => {
        // Update the button in the DOM
        const button = this.elementRef.nativeElement.querySelector(
          `[data-code-block-id="${blockId}"]`
        );
        if (button) {
          const originalHTML = button.innerHTML;
          button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            <span>${this.labels.assistantMessageToolbarCopyCodeCopiedLabel}</span>
          `;
          button.setAttribute(
            "aria-label",
            `${this.labels.assistantMessageToolbarCopyCodeCopiedLabel} code`
          );

          // Reset after 2 seconds
          setTimeout(() => {
            button.innerHTML = originalHTML;
            button.setAttribute(
              "aria-label",
              `${this.labels.assistantMessageToolbarCopyCodeLabel} code`
            );
          }, 2000);
        }
      },
      (err) => {
        console.error("Failed to copy code:", err);
      }
    );
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
