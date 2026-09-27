import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from "@angular/core";
import type {
  AngularToolCall,
  RenderToolCallConfig,
  ToolRenderer,
} from "@copilotkit/angular";
import { z } from "zod";

/**
 * Example tool-call renderers for stories. They're what an app would write:
 * plain component CSS against the host's design tokens (see
 * .storybook/preview.css), so they read correctly in light and dark.
 */

const toolCardStyles = `
  :host {
    display: block;
    margin: 0.5rem 0;
  }
  .card {
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    padding: 0.75rem 0.875rem;
    background: var(--card);
    color: var(--card-foreground);
    font-size: 0.875rem;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
  }
  .status {
    border-radius: 999px;
    padding: 0.125rem 0.5rem;
    background: var(--muted);
    color: var(--muted-foreground);
    font-size: 0.75rem;
    font-weight: 500;
  }
  .status[data-status="complete"] {
    color: var(--success);
    background: color-mix(in oklab, var(--success) 14%, transparent);
  }
  .meta {
    margin-top: 0.375rem;
    color: var(--muted-foreground);
  }
  .result {
    margin-top: 0.625rem;
    border-top: 1px solid var(--border);
    padding-top: 0.625rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.625rem;
  }
  button {
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) - 2px);
    padding: 0.25rem 0.625rem;
    background: var(--background);
    color: var(--foreground);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
  }
  button:hover {
    background: var(--accent);
  }
  pre {
    margin: 0.5rem 0 0;
    overflow-x: auto;
    border-radius: calc(var(--radius) - 2px);
    padding: 0.5rem 0.625rem;
    background: var(--muted);
    color: var(--foreground);
    font-size: 0.75rem;
  }
`;

const statusLabel = (status: AngularToolCall["status"]) =>
  status === "complete"
    ? "Done"
    : status === "executing"
      ? "Running"
      : "Preparing";

export const searchArgsSchema = z.object({
  query: z.string(),
  filters: z.array(z.string()).optional(),
});
type SearchArgs = z.infer<typeof searchArgsSchema>;

@Component({
  selector: "story-search-tool",
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: toolCardStyles,
  template: `
    <div class="card">
      <div class="head">
        <span class="title"><span aria-hidden="true">🔍</span> Search</span>
        <span class="status" [attr.data-status]="toolCall().status">{{
          status()
        }}</span>
      </div>
      <div class="meta">
        “{{ toolCall().args.query }}”
        @if (toolCall().args.filters?.length) {
          · {{ toolCall().args.filters?.join(", ") }}
        }
      </div>
      @if (toolCall().result; as result) {
        <div class="result">{{ result }}</div>
      }
    </div>
  `,
})
export class StorySearchToolRenderer implements ToolRenderer<SearchArgs> {
  readonly toolCall = input.required<AngularToolCall<SearchArgs>>();
  protected readonly status = computed(() =>
    statusLabel(this.toolCall().status),
  );
}

export const calculatorArgsSchema = z.object({ expression: z.string() });
type CalculatorArgs = z.infer<typeof calculatorArgsSchema>;

@Component({
  selector: "story-calculator-tool",
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: toolCardStyles,
  template: `
    <div class="card">
      <div class="head">
        <span class="title"><span aria-hidden="true">🧮</span> Calculator</span>
        <span class="status" [attr.data-status]="toolCall().status">{{
          status()
        }}</span>
      </div>
      <div class="meta">{{ toolCall().args.expression }}</div>
      @if (toolCall().result; as result) {
        <div class="result">
          = <strong>{{ result }}</strong>
        </div>
      }
      <div class="row">
        <button type="button" (click)="clicks.set(clicks() - 1)">−</button>
        <span>Interactive state: {{ clicks() }}</span>
        <button type="button" (click)="clicks.set(clicks() + 1)">+</button>
      </div>
    </div>
  `,
})
export class StoryCalculatorToolRenderer implements ToolRenderer<CalculatorArgs> {
  readonly toolCall = input.required<AngularToolCall<CalculatorArgs>>();
  protected readonly clicks = signal(0);
  protected readonly status = computed(() =>
    statusLabel(this.toolCall().status),
  );
}

@Component({
  selector: "story-wildcard-tool",
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: toolCardStyles,
  template: `
    <div class="card">
      <div class="head">
        <span class="title"
          ><span aria-hidden="true">🔧</span> {{ toolCall().name }}</span
        >
        <span class="status" [attr.data-status]="toolCall().status">{{
          status()
        }}</span>
      </div>
      <pre>{{ args() }}</pre>
      @if (toolCall().result; as result) {
        <div class="result">{{ result }}</div>
      }
    </div>
  `,
})
export class StoryWildcardToolRenderer implements ToolRenderer {
  readonly toolCall = input.required<AngularToolCall>();
  protected readonly args = computed(() =>
    JSON.stringify(this.toolCall().args, null, 2),
  );
  protected readonly status = computed(() =>
    statusLabel(this.toolCall().status),
  );
}

export const storyToolRenderers: RenderToolCallConfig[] = [
  {
    name: "search",
    args: searchArgsSchema,
    component: StorySearchToolRenderer,
  },
  {
    name: "calculator",
    args: calculatorArgsSchema,
    component: StoryCalculatorToolRenderer,
  },
  {
    name: "*",
    args: z.record(z.string(), z.unknown()),
    component: StoryWildcardToolRenderer,
  },
] as RenderToolCallConfig[];
