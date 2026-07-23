import type { Type } from "@angular/core";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";
import type {
  AngularToolCall,
  RenderActivityMessageConfig,
  RenderToolCallConfig,
} from "@copilotkit/angular";
import { z } from "zod";

const backgroundTaskContentSchema = z
  .object({
    taskId: z.string().optional(),
    toolName: z.string().optional(),
    toolCallId: z.string().optional(),
    status: z.string().optional(),
    args: z.record(z.unknown()).optional(),
    outputs: z.array(z.unknown()).optional(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
  })
  .passthrough();

export type BackgroundTaskContent = z.infer<typeof backgroundTaskContentSchema>;

@Component({
  selector: "showcase-background-task-activity",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "mastra-activity-host" },
  template: `
    <article
      class="activity-card"
      data-testid="background-task-activity"
      [attr.data-status]="content().status ?? 'running'"
      aria-live="polite"
    >
      <div class="activity-heading">
        <span
          class="status-dot"
          [class.working]="isWorking()"
          aria-hidden="true"
        ></span>
        <span class="activity-copy">
          <strong>Deep research</strong>
          <small>{{ topic() }}</small>
        </span>
        <span class="status-pill" data-testid="background-task-status">
          {{ statusLabel() }}
        </span>
      </div>
      <p>
        Running in the background — the conversation stays responsive while this
        task works.
      </p>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        max-width: 28rem;
        margin: 0.5rem 0;
      }
      .activity-card {
        border: 1px solid #dbe1ea;
        border-radius: 1rem;
        padding: 1rem;
        background: #fff;
        box-shadow: 0 1px 3px rgb(15 23 42 / 0.08);
        color: #0f172a;
      }
      .activity-heading {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .activity-copy {
        display: flex;
        min-width: 0;
        flex-direction: column;
      }
      .activity-copy small,
      p {
        color: #64748b;
      }
      .activity-copy small {
        overflow-wrap: anywhere;
      }
      .status-dot {
        width: 0.75rem;
        height: 0.75rem;
        flex: 0 0 auto;
        border-radius: 999px;
        background: #64748b;
      }
      .status-dot.working {
        background: #f59e0b;
      }
      .status-pill {
        margin-left: auto;
        border-radius: 999px;
        background: #f1f5f9;
        padding: 0.2rem 0.55rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: #475569;
      }
      p {
        margin: 0.75rem 0 0;
        font-size: 0.75rem;
        line-height: 1.45;
      }
    `,
  ],
})
export class BackgroundTaskActivityCard {
  readonly activityType = input.required<string>();
  readonly content = input.required<BackgroundTaskContent>();
  readonly message = input.required<unknown>();
  readonly agent = input<unknown>();

  protected readonly isWorking = computed(() =>
    [undefined, "running", "resumed"].includes(this.content().status),
  );
  protected readonly statusLabel = computed(() => {
    switch (this.content().status) {
      case "completed":
        return "Completed";
      case "failed":
        return "Failed";
      case "cancelled":
        return "Cancelled";
      case "suspended":
        return "Paused";
      default:
        return "Working…";
    }
  });
  protected readonly topic = computed(() => {
    const content = this.content();
    const topic = content.args?.["topic"];
    if (typeof topic === "string") return topic;
    return content.toolName?.replace(/[-_]/g, " ") ?? "task";
  });
}

const observationalMemoryContentSchema = z
  .object({
    cycleId: z.string(),
    operationType: z.enum(["observation", "reflection"]).optional(),
    phase: z.string(),
    status: z.string(),
    threadId: z.string().optional(),
    observations: z.string().optional(),
    currentTask: z.string().optional(),
    suggestedResponse: z.string().optional(),
    tokensToObserve: z.number().optional(),
    tokensObserved: z.number().optional(),
    bufferedTokens: z.number().optional(),
    observationTokens: z.number().optional(),
    tokensActivated: z.number().optional(),
    chunksActivated: z.number().optional(),
    messagesActivated: z.number().optional(),
    triggeredBy: z.string().optional(),
    durationMs: z.number().optional(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export type ObservationalMemoryContent = z.infer<
  typeof observationalMemoryContentSchema
>;

const PHASE_LABELS: Readonly<Record<string, string>> = {
  observation: "Observing conversation",
  buffering: "Compressing memory",
  activation: "Activating observations",
};

const STATUS_LABELS: Readonly<Record<string, string>> = {
  running: "Working",
  completed: "Compressed",
  activated: "Activated",
  failed: "Failed",
};

@Component({
  selector: "showcase-observational-memory-activity",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "mastra-activity-host" },
  template: `
    <article
      class="om-card"
      data-testid="om-activity-card"
      [attr.data-om-phase]="content().phase"
      [attr.data-om-status]="content().status"
      aria-live="polite"
    >
      <header>
        <span
          class="om-dot"
          data-testid="om-status-dot"
          [class.running]="content().status === 'running'"
          [class.failed]="content().status === 'failed'"
          aria-hidden="true"
        ></span>
        <strong>{{ phaseLabel() }}</strong>
        <span class="om-status">· {{ statusLabel() }}</span>
      </header>
      @if (content().observations; as observations) {
        <p data-testid="om-observations">{{ observations }}</p>
      }
      @if (tokenDetail(); as detail) {
        <small>{{ detail }}</small>
      }
      @if (content().error; as error) {
        <p class="error" role="alert">{{ error }}</p>
      }
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        margin: 0.5rem 0;
      }
      .om-card {
        border: 1px solid #dbe1ea;
        border-radius: 0.75rem;
        padding: 0.75rem 0.875rem;
        background: #f8fafc;
        color: #0f172a;
        font-size: 0.8125rem;
      }
      header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .om-dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 999px;
        background: #10b981;
      }
      .om-dot.running {
        background: #f59e0b;
      }
      .om-dot.failed {
        background: #dc2626;
      }
      .om-status,
      small {
        color: #64748b;
      }
      p {
        margin: 0.4rem 0 0;
        line-height: 1.45;
      }
      small {
        display: block;
        margin-top: 0.4rem;
      }
      .error {
        color: #b91c1c;
      }
    `,
  ],
})
export class ObservationalMemoryActivityCard {
  readonly activityType = input.required<string>();
  readonly content = input.required<ObservationalMemoryContent>();
  readonly message = input.required<unknown>();
  readonly agent = input<unknown>();

  protected readonly phaseLabel = computed(
    () => PHASE_LABELS[this.content().phase] ?? this.content().phase,
  );
  protected readonly statusLabel = computed(
    () => STATUS_LABELS[this.content().status] ?? this.content().status,
  );
  protected readonly tokenDetail = computed(() => {
    const content = this.content();
    if (typeof content.bufferedTokens === "number") {
      return `${content.bufferedTokens} tokens buffered`;
    }
    if (typeof content.tokensActivated === "number") {
      return `${content.tokensActivated} tokens activated`;
    }
    return undefined;
  });
}

interface BrowseResult {
  title?: string;
  url?: string;
  points?: number;
  source?: string;
}

interface BrowseWebResult {
  mode?: "hackernews" | "page";
  results?: BrowseResult[];
  text?: string;
  error?: string;
}

@Component({
  selector: "showcase-browse-results-tool-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="browse-card"
      data-testid="browse-results-card"
      aria-live="polite"
    >
      <header>
        <span aria-hidden="true">🌐</span>
        <strong>{{ heading() }}</strong>
        <span class="badge">{{ badge() }}</span>
      </header>
      @if (loading()) {
        <p>Browsing…</p>
      } @else if (result().error; as error) {
        <p class="error" data-testid="browse-error" role="alert">{{ error }}</p>
      } @else if (result().results?.length) {
        <ul>
          @for (item of result().results; track item.url ?? item.title ?? $index) {
            <li data-testid="browse-result-row">
              <span>
                @if (item.url; as url) {
                  <a [href]="url" target="_blank" rel="noopener noreferrer">
                    {{ item.title ?? url }}
                  </a>
                } @else {
                  <strong>{{ item.title ?? "—" }}</strong>
                }
                @if (item.source; as source) {
                  <small>{{ source }}</small>
                }
              </span>
              @if (item.points !== undefined) {
                <small>{{ item.points }} pts</small>
              }
            </li>
          }
        </ul>
        @if (result().text; as text) {
          <p class="summary">{{ text }}</p>
        }
      } @else {
        <p>No results returned.</p>
      }
    </article>
  `,
  styles: [
    `
      .browse-card {
        margin: 0.75rem 0;
        border: 1px solid #dbe1ea;
        border-radius: 1rem;
        padding: 1rem;
        background: #fff;
        color: #0f172a;
        box-shadow: 0 1px 3px rgb(15 23 42 / 0.08);
      }
      header,
      li {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
      }
      header {
        align-items: center;
      }
      .badge {
        margin-left: auto;
        border-radius: 999px;
        background: #f1f5f9;
        padding: 0.2rem 0.55rem;
        color: #475569;
        font-size: 0.7rem;
        text-transform: uppercase;
      }
      ul {
        display: grid;
        gap: 0.5rem;
        margin: 0.75rem 0 0;
        padding: 0;
        list-style: none;
      }
      li {
        justify-content: space-between;
        border: 1px solid #e5e7eb;
        border-radius: 0.75rem;
        padding: 0.65rem 0.75rem;
        background: #f8fafc;
      }
      li > span {
        min-width: 0;
      }
      a {
        color: #0f172a;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      small {
        display: block;
        color: #64748b;
      }
      p {
        color: #64748b;
      }
      .error {
        color: #b91c1c;
      }
      .summary {
        border-top: 1px solid #e5e7eb;
        padding-top: 0.75rem;
        line-height: 1.45;
      }
    `,
  ],
})
export class BrowseResultsToolCard {
  readonly toolCall = input.required<AngularToolCall<{ task: string }>>();
  protected readonly loading = computed(
    () => this.toolCall().status !== "complete",
  );
  protected readonly result = computed(() =>
    parseBrowseResult(this.toolCall().result),
  );
  protected readonly heading = computed(() => {
    switch (this.result().mode) {
      case "page":
        return "Page read";
      case "hackernews":
        return "Top stories";
      default:
        return "Browsing";
    }
  });
  protected readonly badge = computed(() => {
    if (this.loading()) return "Browsing…";
    if (this.result().error) return "Error";
    const count = this.result().results?.length ?? 0;
    return `${count} result${count === 1 ? "" : "s"}`;
  });
}

function parseBrowseResult(result: unknown): BrowseWebResult {
  if (typeof result !== "string" || result.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(result);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as BrowseWebResult)
      : {};
  } catch {
    return {};
  }
}

/** Ready-to-register background-task activity renderer. */
export const backgroundTaskActivityRendererConfig: RenderActivityMessageConfig<BackgroundTaskContent> =
  {
    activityType: "mastra-background-task",
    content: backgroundTaskContentSchema,
    component: asActivityRenderer<BackgroundTaskContent>(
      BackgroundTaskActivityCard,
    ),
  };

/** Ready-to-register observational-memory activity renderer. */
export const observationalMemoryActivityRendererConfig: RenderActivityMessageConfig<ObservationalMemoryContent> =
  {
    activityType: "mastra-observational-memory",
    content: observationalMemoryContentSchema,
    component: asActivityRenderer<ObservationalMemoryContent>(
      ObservationalMemoryActivityCard,
    ),
  };

/** Isolate the source-workspace Angular-major type brand from packed consumers. */
export function asBrowseRenderer(
  component: Type<unknown>,
): RenderToolCallConfig<{ task: string }>["component"] {
  return component as unknown as RenderToolCallConfig<{
    task: string;
  }>["component"];
}

/** Isolate the source-workspace Angular-major type brand from packed consumers. */
function asActivityRenderer<T>(
  component: Type<unknown>,
): RenderActivityMessageConfig<T>["component"] {
  return component as unknown as RenderActivityMessageConfig<T>["component"];
}
