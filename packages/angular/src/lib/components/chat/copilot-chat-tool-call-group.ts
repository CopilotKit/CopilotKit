import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  signal,
} from "@angular/core";
import type { Signal } from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import type { AssistantMessage, Message } from "@ag-ui/core";
import {
  ɵcountFailedToolCalls,
  ɵformatLabel,
  ɵformatToolNames,
  ɵgetToolCallPreview,
  ɵgetToolCallRowStatus,
  ɵformatCountLabel,
} from "@copilotkit/core";
import { ChevronRight, CopilotIcon } from "../icons/copilot-icon";
import {
  CopilotCollapsible,
  CopilotToolCallStatusIcon,
} from "../tools/tool-call-parts";
import { RenderToolCall } from "../../render-tool-calls";
import { toolCallRowStatusLabelKeys } from "../tools/tool-call-render-context";
import type {
  CopilotChatToolCallGroupAppearance,
  ToolCallRenderContext,
  ToolCallRowStatus,
} from "../tools/tool-call-render-context";
import type { ToolCallEntry } from "./tool-call-layout";
import { injectChatLabels } from "../../chat-config";
import { cn } from "../../utils";

let nextId = 0;

/**
 * Tool calls made in a row, collapsed into one summary, like React's
 * `CopilotChatToolCallGroup`. While a call runs the summary names it
 * ("Running read_file  src/app.ts"); once they're all done it reads
 * "Used 3 tools" and opens to the calls.
 *
 * Each call is drawn by its registered renderer. CopilotKit's built-in card
 * draws a compact row inside the card and line appearances and an open stack.
 */
@Component({
  selector: "copilot-chat-tool-call-group",
  imports: [
    CopilotCollapsible,
    CopilotIcon,
    CopilotToolCallStatusIcon,
    NgTemplateOutlet,
    RenderToolCall,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { style: "display: contents" },
  template: `
    <ng-template #rows>
      @for (call of calls(); track call.toolCall.id) {
        <ng-container
          *ngTemplateOutlet="callTemplate; context: { $implicit: call }"
        />
      }
    </ng-template>

    <ng-template #callTemplate let-call>
      <copilot-render-tool-call
        [toolCall]="call.toolCall"
        [message]="message()"
        [messages]="messages()"
        [agentId]="agentId()"
        [isLoading]="isLoading()"
        [row]="rowFor(call.toolCall.id)"
      />
    </ng-template>

    @if (latest(); as latest) {
      @switch (appearance()) {
        @case ("line") {
          @if (calls().length === 1 && !current()) {
            <div
              data-copilotkit
              data-testid="copilot-tool-call-group"
              data-appearance="line"
              [attr.data-state]="status()"
              class="cpk-tool-call-group cpk-tool-call-group-line cpk-tool-call-group-single"
            >
              <ng-container
                *ngTemplateOutlet="callTemplate; context: { $implicit: latest }"
              />
            </div>
          } @else {
            <div
              data-copilotkit
              data-testid="copilot-tool-call-group"
              data-appearance="line"
              [attr.data-state]="status()"
              class="cpk-tool-call-group cpk-tool-call-group-line"
            >
              <button
                type="button"
                [attr.aria-expanded]="open()"
                [attr.aria-controls]="bodyId"
                (click)="toggle()"
                class="cpk-tool-call-group-line-toggle"
              >
                @if (current(); as current) {
                  <ng-container
                    *ngTemplateOutlet="
                      runningLabel;
                      context: { $implicit: current }
                    "
                  />
                } @else {
                  <span class="cpk-tool-call-group-line-summary">
                    {{ usedToolsText() }}
                  </span>
                  <span class="cpk-tool-call-group-line-names">
                    {{ names() }}
                  </span>
                  <ng-container *ngTemplateOutlet="failedCountLabel" />
                }
                <copilot-icon
                  [img]="ChevronRightIcon"
                  [iconClass]="chevronClass()"
                />
              </button>
              <div [copilotCollapsible]="open()" [id]="bodyId">
                <div class="cpk-tool-call-group-line-body">
                  <ng-container *ngTemplateOutlet="rows" />
                </div>
              </div>
            </div>
          }
        }
        @case ("stack") {
          <div
            data-copilotkit
            data-testid="copilot-tool-call-group"
            data-appearance="stack"
            [attr.data-state]="status()"
            class="cpk-tool-call-group cpk-tool-call-group-stack"
            [style.padding-bottom.px]="behind().length * 6"
          >
            <div class="cpk-tool-call-group-stack-pile">
              @for (index of behind(); track index) {
                <div
                  aria-hidden="true"
                  class="cpk-tool-call-group-stack-layer cpk-tool-call-group-stack-behind"
                  [style.transform]="
                    'translateY(' +
                    (index + 1) * 6 +
                    'px) scaleX(' +
                    (1 - (index + 1) * 0.045) +
                    ')'
                  "
                  [style.z-index]="-1 - index"
                  [style.opacity]="1 - (index + 1) * 0.28"
                ></div>
              }
              <button
                type="button"
                [attr.aria-expanded]="open()"
                [attr.aria-controls]="open() ? bodyId : null"
                (click)="toggle()"
                [class]="
                  open()
                    ? 'cpk-tool-call-group-stack-toggle cpk-tool-call-group-stack-toggle-open'
                    : 'cpk-tool-call-group-stack-toggle cpk-tool-call-group-stack-layer cpk-tool-call-group-stack-toggle-closed'
                "
              >
                @if (open()) {
                  {{ toolCallCountText() }}
                  <ng-container *ngTemplateOutlet="failedCountLabel" />
                  <span class="cpk-tool-call-group-stack-collapse">
                    {{ labels.toolCallCollapseLabel }}
                    <copilot-icon
                      [img]="ChevronRightIcon"
                      iconClass="cpk-tool-call-chevron cpk-tool-call-chevron-open cpk-tool-call-group-stack-collapse-icon"
                    />
                  </span>
                } @else {
                  <span class="cpk-tool-call-group-stack-latest">
                    <copilot-tool-call-status-icon [status]="latestStatus()" />
                    <span
                      class="cpk-tool-call-group-stack-name"
                      [class.cpk-shimmer]="latestStatus() === 'running'"
                    >
                      {{ latest.toolCall.function.name }}
                    </span>
                    @if (latestPreview(); as preview) {
                      <span class="cpk-tool-call-group-stack-preview">
                        {{ preview }}
                      </span>
                    }
                    <!-- The status icon is decorative, so say the status. -->
                    <span class="cpk-tool-call-group-stack-status">
                      {{ statusText(latestStatus()) }}
                    </span>
                  </span>
                  <span class="cpk-tool-call-group-stack-meta">
                    <ng-container *ngTemplateOutlet="failedCountLabel" />
                    <span class="cpk-tool-call-group-stack-count">
                      {{ callCountText() }}
                    </span>
                    <copilot-icon
                      [img]="ChevronRightIcon"
                      iconClass="cpk-tool-call-chevron cpk-tool-call-group-stack-expand-icon"
                    />
                  </span>
                }
              </button>
              <!-- Always rendered, so screen readers hear the closed stack's
                   latest call change; the button only names it. -->
              <span aria-live="polite" class="cpk-tool-call-group-stack-live">{{
                open()
                  ? ""
                  : latest.toolCall.function.name +
                    ": " +
                    statusText(latestStatus())
              }}</span>
            </div>
            @if (open()) {
              <!-- Each call gets the collapsed stack's card, easing out of the stack. -->
              <div [id]="bodyId" class="cpk-tool-call-group-stack-items">
                @for (call of calls(); track call.toolCall.id; let index = $index) {
                  <div
                    class="cpk-tool-call-group-stack-layer cpk-tool-call-group-stack-item"
                    [style.animation-delay.ms]="index * 30"
                  >
                    <ng-container
                      *ngTemplateOutlet="callTemplate; context: { $implicit: call }"
                    />
                  </div>
                }
              </div>
            }
          </div>
        }
        @default {
          <!-- card: one call gets the same card as several, so the card a run
               starts with doesn't change style when the next call joins it. -->
          <div
            data-copilotkit
            data-testid="copilot-tool-call-group"
            data-appearance="card"
            [attr.data-state]="status()"
            class="cpk-tool-call-group cpk-tool-call-group-card"
          >
            <button
              type="button"
              [attr.aria-expanded]="open()"
              [attr.aria-controls]="bodyId"
              (click)="toggle()"
              class="cpk-tool-call-group-card-toggle"
            >
              <copilot-tool-call-status-icon [status]="status()" />
              @if (current(); as current) {
                <ng-container
                  *ngTemplateOutlet="runningLabel; context: { $implicit: current }"
                />
              } @else {
                <span class="cpk-tool-call-group-card-summary">
                  {{ usedToolsText() }}
                </span>
                <span class="cpk-tool-call-group-card-names">
                  {{ names() }}
                </span>
              }
              <span class="cpk-tool-call-group-card-meta">
                @if (status() === "failed") {
                  <ng-container *ngTemplateOutlet="failedCountLabel" />
                } @else {
                  <span class="cpk-tool-call-group-card-status">
                    @if (status() !== "running") {
                      {{ statusText(status()) }}
                    } @else if (doneCount() > 0) {
                      {{ doneCountText() }}
                    }
                  </span>
                }
                <copilot-icon
                  [img]="ChevronRightIcon"
                  [iconClass]="chevronClass()"
                />
              </span>
            </button>
            <div [copilotCollapsible]="open()" [id]="bodyId">
              <div><ng-container *ngTemplateOutlet="rows" /></div>
            </div>
          </div>
        }
      }
    }

    <ng-template #runningLabel let-current>
      <span class="cpk-tool-call-group-running cpk-shimmer">
        {{ runningText(current) }}
      </span>
      @if (preview(); as preview) {
        <span class="cpk-tool-call-group-preview">{{ preview }}</span>
      }
    </ng-template>

    <ng-template #failedCountLabel>
      @if (failedCount() > 0) {
        <span class="cpk-tool-call-failed-count">{{ failedCountText() }}</span>
      }
    </ng-template>
  `,
})
export class CopilotChatToolCallGroup {
  /** The calls in the group, in order. */
  readonly calls = input.required<ToolCallEntry[]>();
  /**
   * - `"card"` (default): one card with a summary header and a row per call.
   * - `"line"`: a quiet line of text that opens to a list of rows.
   * - `"stack"`: the latest call on a stack of the earlier ones.
   */
  readonly appearance = input<CopilotChatToolCallGroupAppearance>("card");
  /** The agent is running and nothing follows the group, so more calls may join it. */
  readonly isActive = input(false);
  /** The message the group starts in. */
  readonly message = input.required<AssistantMessage>();
  readonly messages = input<Message[]>([]);
  readonly agentId = input<string | undefined>();
  readonly isLoading = input(false);

  protected readonly open = signal(false);
  protected readonly bodyId = `cpk-tool-call-group-${nextId++}`;
  protected readonly labels = injectChatLabels();
  protected readonly ChevronRightIcon = ChevronRight;

  protected readonly latest = computed(() => this.calls().at(-1));
  /**
   * Only an active group has a call in progress. Between calls nothing is
   * running, so the latest call stays the subject (or the label flickers).
   */
  protected readonly current = computed(() =>
    this.isActive()
      ? (this.calls().find((call) => !call.toolMessage) ?? this.latest())
      : undefined,
  );
  protected readonly preview = computed(() => {
    const current = this.current();
    return current ? ɵgetToolCallPreview(current) : undefined;
  });
  protected readonly statuses = computed(
    () =>
      new Map(
        this.calls().map((call) => [
          call.toolCall.id,
          ɵgetToolCallRowStatus(call, this.isActive()),
        ]),
      ),
  );
  protected readonly failedCount = computed(() =>
    ɵcountFailedToolCalls(this.calls()),
  );
  protected readonly failedCountText = computed(() =>
    ɵformatLabel(this.labels.toolCallFailedCountLabel, {
      count: this.failedCount(),
    }),
  );
  protected readonly usedToolsText = computed(() =>
    ɵformatCountLabel(this.calls().length, {
      one: this.labels.toolCallUsedToolsOne,
      other: this.labels.toolCallUsedToolsOther,
    }),
  );
  protected readonly toolCallCountText = computed(() =>
    ɵformatCountLabel(this.calls().length, {
      one: this.labels.toolCallToolCallCountOne,
      other: this.labels.toolCallToolCallCountOther,
    }),
  );
  protected readonly callCountText = computed(() =>
    ɵformatCountLabel(this.calls().length, {
      one: this.labels.toolCallCallCountOne,
      other: this.labels.toolCallCallCountOther,
    }),
  );
  protected readonly doneCount = computed(
    () => this.calls().filter((call) => call.toolMessage).length,
  );
  protected readonly doneCountText = computed(() =>
    ɵformatLabel(this.labels.toolCallDoneCountLabel, {
      count: this.doneCount(),
    }),
  );
  protected readonly status = computed<ToolCallRowStatus>(() => {
    if (this.current()) return "running";
    const statuses = [...this.statuses().values()];
    if (statuses.includes("failed")) return "failed";
    if (statuses.includes("stopped")) return "stopped";
    return "done";
  });
  protected readonly names = computed(() => ɵformatToolNames(this.calls()));
  protected readonly latestStatus = computed<ToolCallRowStatus>(() => {
    const latest = this.latest();
    return latest ? ɵgetToolCallRowStatus(latest, this.isActive()) : "done";
  });
  protected readonly latestPreview = computed(() => {
    const latest = this.latest();
    return latest ? ɵgetToolCallPreview(latest) : undefined;
  });
  /** A lone call is the top card of a stack with nothing behind it yet. */
  protected readonly behind = computed(() =>
    Array.from(
      { length: this.open() ? 0 : Math.min(this.calls().length - 1, 2) },
      (_, index) => index,
    ),
  );
  protected readonly chevronClass = computed(() =>
    cn("cpk-tool-call-chevron", this.open() && "cpk-tool-call-chevron-open"),
  );
  // One row context per call, kept while the call is in the group, so its
  // renderer isn't recreated when the calls update.
  readonly #rows = new Map<
    string,
    {
      appearance: CopilotChatToolCallGroupAppearance;
      row: NonNullable<ToolCallRenderContext["row"]>;
    }
  >();

  protected rowFor(toolCallId: string): ToolCallRenderContext["row"] {
    const appearance = this.appearance();
    const cached = this.#rows.get(toolCallId);
    if (cached && cached.appearance === appearance) return cached.row;
    const status: Signal<ToolCallRowStatus> = computed(
      () => this.statuses().get(toolCallId) ?? "done",
    );
    const row = { appearance, status };
    this.#rows.set(toolCallId, { appearance, row });
    return row;
  }

  protected statusText(status: ToolCallRowStatus) {
    return this.labels[toolCallRowStatusLabelKeys[status]];
  }

  protected runningText(entry: ToolCallEntry) {
    return ɵformatLabel(this.labels.toolCallRunningLabel, {
      name: entry.toolCall.function.name,
    });
  }

  protected toggle(): void {
    this.open.update((value) => !value);
  }
}
