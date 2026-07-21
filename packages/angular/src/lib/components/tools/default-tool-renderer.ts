import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from "@angular/core";

import type { AngularToolCall, ToolRenderer } from "../../tools";

/** Serialize untrusted tool values defensively for text-only display. */
export function safeToolValue(value: unknown): string {
  if (typeof value === "string") return value;
  const seen = new WeakSet<object>();
  try {
    const serialized = JSON.stringify(
      value,
      (_key, candidate: unknown) => {
        if (typeof candidate === "bigint") return `${candidate.toString()}n`;
        if (typeof candidate === "undefined") return "[Undefined]";
        if (typeof candidate === "function") return "[Function]";
        if (typeof candidate === "symbol") return candidate.toString();
        if (typeof candidate === "object" && candidate !== null) {
          if (seen.has(candidate)) return "[Circular]";
          seen.add(candidate);
        }
        return candidate;
      },
      2,
    );
    return serialized ?? String(value);
  } catch {
    return "[Unserializable value]";
  }
}

/** Opt-in text-only fallback for tool calls without an application renderer. */
@Component({
  selector: "copilot-default-tool-renderer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "copilot-default-tool-renderer" },
  template: `
    <article class="tool-card" data-testid="copilot-tool-render">
      <button
        type="button"
        class="tool-summary"
        [attr.aria-expanded]="expanded()"
        (click)="toggleExpanded()"
      >
        <span class="tool-name">{{ toolCall().name || "Tool call" }}</span>
        <span
          class="tool-status"
          data-testid="copilot-tool-render-status"
          aria-live="polite"
          >{{ statusLabel() }}</span
        >
        <span aria-hidden="true">{{ expanded() ? "▾" : "▸" }}</span>
      </button>
      @if (expanded()) {
        <div class="tool-details">
          <h3>Arguments</h3>
          <pre>{{ argumentsText() }}</pre>
          @if (toolCall().result !== undefined) {
            <h3>Result</h3>
            <pre>{{ resultText() }}</pre>
          }
        </div>
      }
    </article>
  `,
  styles: `
    :host {
      display: block;
      margin-block: 0.5rem;
    }
    .tool-card {
      overflow: hidden;
      border: 1px solid #dbe3eb;
      border-radius: 0.5rem;
      color: #1e293b;
      background: #f8fafc;
    }
    .tool-summary {
      display: grid;
      width: 100%;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 0.75rem;
      padding: 0.65rem 0.75rem;
      border: 0;
      color: inherit;
      background: transparent;
      text-align: left;
      cursor: pointer;
    }
    .tool-summary:focus-visible {
      outline: 3px solid #2563eb;
      outline-offset: -3px;
    }
    .tool-name {
      overflow-wrap: anywhere;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8125rem;
      font-weight: 600;
    }
    .tool-status {
      color: #52637a;
      font-size: 0.75rem;
    }
    .tool-details {
      padding: 0 0.75rem 0.75rem;
      border-top: 1px solid #dbe3eb;
    }
    .tool-details h3 {
      margin: 0.75rem 0 0.25rem;
      font-size: 0.75rem;
    }
    .tool-details pre {
      max-height: 16rem;
      margin: 0;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 0.75rem;
    }
  `,
})
export class CopilotDefaultToolRenderer implements ToolRenderer {
  readonly toolCall = input.required<AngularToolCall>();
  protected readonly expanded = signal(false);
  protected readonly argumentsText = computed(() =>
    safeToolValue(this.toolCall().args),
  );
  protected readonly resultText = computed(() =>
    safeToolValue(this.toolCall().result),
  );
  protected readonly statusLabel = computed(() => {
    switch (this.toolCall().status as string) {
      case "in-progress":
        return "Preparing";
      case "executing":
        return "Running";
      case "complete":
        return "Complete";
      default:
        return "Unknown status";
    }
  });

  protected toggleExpanded(): void {
    this.expanded.update((value) => !value);
  }
}
