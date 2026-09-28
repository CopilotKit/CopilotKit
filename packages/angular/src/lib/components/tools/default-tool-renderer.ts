import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from "@angular/core";

import type { AngularToolCall, ToolRenderer } from "../../tools";
import {
  Check,
  ChevronRight,
  Circle,
  CopilotIcon,
  LoaderCircle,
} from "../icons/copilot-icon";

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

/**
 * Opt-in text-only fallback for tool calls without an application renderer.
 * Mirrors React's `DefaultToolCallRenderer`: one header row (status icon,
 * tool name, status label, chevron) that expands to the arguments and result.
 */
@Component({
  selector: "copilot-default-tool-renderer",
  imports: [CopilotIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "copilot-default-tool-renderer" },
  template: `
    <article
      class="tool-card"
      data-copilotkit
      data-testid="copilot-tool-render"
      [attr.data-tool-name]="toolCall().name || 'unknown'"
      [attr.data-status]="statusValue()"
    >
      <button
        type="button"
        class="tool-summary"
        [attr.aria-expanded]="expanded()"
        (click)="toggleExpanded()"
      >
        <copilot-icon
          class="tool-status-icon"
          [class.is-active]="isActive()"
          [img]="statusIcon()"
          [size]="14"
        />
        <span
          class="tool-name"
          data-testid="copilot-tool-render-name"
          [class.cpk-shimmer]="isActive()"
          >{{ toolCall().name || "Tool call" }}</span
        >
        <span
          class="tool-status"
          data-testid="copilot-tool-render-status"
          aria-live="polite"
          [class.cpk-shimmer]="isActive()"
          >{{ statusLabel() }}</span
        >
        <copilot-icon
          class="tool-chevron"
          [class.is-expanded]="expanded()"
          [img]="ChevronRight"
          [size]="14"
        />
      </button>
      @if (expanded()) {
        <div class="tool-details">
          <section>
            <h3 class="tool-label">Arguments</h3>
            <pre>{{ argumentsText() }}</pre>
          </section>
          @if (toolCall().result !== undefined) {
            <section>
              <h3 class="tool-label">Result</h3>
              <pre>{{ resultText() }}</pre>
            </section>
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
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) + 4px);
      color: var(--card-foreground);
      background: var(--card);
    }
    .tool-summary {
      display: flex;
      width: 100%;
      align-items: center;
      gap: 0.625rem;
      margin: 0;
      padding: 0.625rem 0.875rem;
      border: 0;
      color: inherit;
      background: transparent;
      font: inherit;
      text-align: left;
      cursor: pointer;
      user-select: none;
      transition: background-color 150ms;
    }
    .tool-summary:hover,
    .tool-summary:focus-visible {
      outline: none;
      background: color-mix(in oklab, var(--accent) 60%, transparent);
    }
    .tool-status-icon,
    .tool-chevron {
      flex-shrink: 0;
      color: var(--muted-foreground);
    }
    .tool-status-icon.is-active {
      animation: tool-spin 1s linear infinite;
    }
    .tool-chevron {
      transition: transform 200ms;
    }
    .tool-chevron.is-expanded {
      transform: rotate(90deg);
    }
    .tool-name {
      min-width: 0;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      font-weight: 500;
    }
    .tool-status {
      flex-shrink: 0;
      font-size: 0.75rem;
    }
    /* .cpk-shimmer (globals.css) paints the text while the call is active. */
    .tool-name:not(.cpk-shimmer) {
      color: var(--foreground);
    }
    .tool-status:not(.cpk-shimmer) {
      color: var(--muted-foreground);
    }
    .tool-details {
      display: grid;
      gap: 0.75rem;
      padding: 0.75rem 0.875rem;
      border-top: 1px solid var(--border);
    }
    .tool-label {
      margin: 0;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.025em;
      text-transform: uppercase;
      color: var(--muted-foreground);
    }
    .tool-details pre {
      max-height: 200px;
      margin: 0.375rem 0 0;
      overflow: auto;
      padding: 0.625rem;
      border-radius: var(--radius);
      background: var(--muted);
      color: var(--foreground);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.75rem;
      line-height: 1.625;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    @keyframes tool-spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .tool-status-icon.is-active,
      .tool-chevron {
        animation: none;
        transition: none;
      }
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
  protected readonly statusValue = computed(() => {
    switch (this.toolCall().status as string) {
      case "in-progress":
        return "inProgress";
      case "executing":
      case "complete":
        return this.toolCall().status as string;
      default:
        return "unknown";
    }
  });
  protected readonly isActive = computed(() => {
    const status = this.toolCall().status as string;
    return status === "in-progress" || status === "executing";
  });
  protected readonly isComplete = computed(
    () => (this.toolCall().status as string) === "complete",
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
  protected readonly statusIcon = computed(() =>
    this.isActive() ? LoaderCircle : this.isComplete() ? Check : Circle,
  );
  protected readonly ChevronRight = ChevronRight;

  protected toggleExpanded(): void {
    this.expanded.update((value) => !value);
  }
}
