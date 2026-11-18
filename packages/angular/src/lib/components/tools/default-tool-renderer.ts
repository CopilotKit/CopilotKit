import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
  signal,
} from "@angular/core";

import {
  ɵgetArgumentPreview,
  ɵgetToolCallBadge,
  ɵnormalizeToolCallStatus,
  ɵstringifyToolCallAttr,
  ɵstringifyToolCallPayload,
} from "@copilotkit/core";
import type { AngularToolCall, ToolRenderer } from "../../tools";
import { injectChatLabels } from "../../chat-config";
import { ChevronRight, CopilotIcon } from "../icons/copilot-icon";
import {
  CopilotCollapsible,
  CopilotToolCallStatusIcon,
} from "./tool-call-parts";
import {
  TOOL_CALL_RENDER_CONTEXT,
  toolCallRowStatusLabelKeys,
} from "./tool-call-render-context";
import { cn } from "../../utils";

/**
 * Serialize untrusted tool values defensively for text-only display.
 *
 * Unlike a plain `JSON.stringify`, a value that cannot be encoded does not
 * fail the whole payload: a circular reference reads `"[Circular]"`, a
 * `bigint` reads `"12n"`, and `undefined`, functions and symbols get a
 * placeholder. Strings pass through. Core's `ɵstringifyToolCallPayload`.
 *
 * @param value - A tool call's arguments or result.
 */
export function safeToolValue(value: unknown): string {
  return ɵstringifyToolCallPayload(value);
}

let nextId = 0;

/**
 * CopilotKit's built-in tool-call card, the same as React's
 * `DefaultToolCallRenderer`. Turn it on with `defaultToolRendering: true`.
 * Inside a group of calls (see `toolCallDisplay`) it draws a compact row that
 * fits the group instead of a card.
 */
@Component({
  selector: "copilot-default-tool-renderer",
  imports: [CopilotCollapsible, CopilotIcon, CopilotToolCallStatusIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: "copilot-default-tool-renderer", style: "display: contents" },
  template: `
    @if (row(); as row) {
      <div
        data-copilotkit
        data-testid="copilot-tool-render"
        [attr.data-tool-name]="name()"
        [attr.data-tool-call-id]="toolCallId"
        [attr.data-status]="statusValue()"
        [attr.data-args]="argsAttr()"
        [attr.data-result]="resultAttr()"
        [class]="'cpk-tool-call-row cpk-tool-call-row-' + row.appearance"
      >
        <button
          type="button"
          [attr.aria-expanded]="expanded()"
          [attr.aria-controls]="detailsId"
          (click)="toggleExpanded()"
          class="cpk-tool-call-row-button"
        >
          <copilot-tool-call-status-icon [status]="row.status()" />
          <span
            data-testid="copilot-tool-render-name"
            class="cpk-tool-call-row-name"
            [class.cpk-shimmer]="row.status() === 'running'"
            >{{ name() }}</span
          >
          @if (preview(); as preview) {
            <span class="cpk-tool-call-row-preview">{{ preview }}</span>
          }
          <span
            data-testid="copilot-tool-render-status"
            class="cpk-tool-call-row-status"
            >{{ labels[rowStatusLabelKeys[row.status()]] }}</span
          >
          <copilot-icon [img]="ChevronRightIcon" [iconClass]="rowChevronClass()" />
        </button>
        <div [copilotCollapsible]="expanded()" [id]="detailsId">
          <div class="cpk-tool-call-payloads cpk-tool-call-row-payloads">
            <div>
              <div class="cpk-tool-call-payload-label">
                {{ labels.toolCallArgumentsLabel }}
              </div>
              <pre class="cpk-tool-call-payload-code">{{ argumentsText() }}</pre>
            </div>
            @if (toolCall().result !== undefined) {
              <div>
                <div class="cpk-tool-call-payload-label">
                  {{ labels.toolCallResultLabel }}
                </div>
                <pre class="cpk-tool-call-payload-code">{{ resultText() }}</pre>
              </div>
            }
          </div>
        </div>
      </div>
    } @else {
      <div
        data-testid="copilot-tool-render"
        [attr.data-tool-name]="name()"
        [attr.data-tool-call-id]="toolCallId"
        [attr.data-status]="statusValue()"
        [attr.data-args]="argsAttr()"
        [attr.data-result]="resultAttr()"
        class="cpk-default-tool-call"
      >
        <div class="cpk-default-tool-call-card">
          <button
            type="button"
            [attr.aria-expanded]="expanded()"
            (click)="toggleExpanded()"
            class="cpk-default-tool-call-header"
            style="font: inherit"
          >
            <div class="cpk-default-tool-call-title">
              <copilot-icon [img]="ChevronRightIcon" [iconClass]="chevronClass()" />
              <span
                [class]="
                  'cpk-default-tool-call-dot cpk-default-tool-call-dot-' + tone()
                "
              ></span>
              <span
                data-testid="copilot-tool-render-name"
                class="cpk-default-tool-call-name"
                >{{ name() }}</span
              >
            </div>
            <span
              data-testid="copilot-tool-render-status"
              [class]="
                'cpk-default-tool-call-badge cpk-default-tool-call-badge-' + tone()
              "
              >{{ statusLabel() }}</span
            >
          </button>

          @if (expanded()) {
            <div class="cpk-default-tool-call-details">
              <div>
                <div class="cpk-default-tool-call-label">
                  {{ labels.toolCallArgumentsLabel }}
                </div>
                <pre class="cpk-default-tool-call-code">{{ argumentsText() }}</pre>
              </div>
              @if (toolCall().result !== undefined) {
                <div>
                  <div class="cpk-default-tool-call-label">
                    {{ labels.toolCallResultLabel }}
                  </div>
                  <pre class="cpk-default-tool-call-code">{{ resultText() }}</pre>
                </div>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class CopilotDefaultToolRenderer implements ToolRenderer {
  readonly toolCall = input.required<AngularToolCall>();
  readonly #context = inject(TOOL_CALL_RENDER_CONTEXT, { optional: true });
  protected readonly toolCallId = this.#context?.toolCallId ?? null;
  protected readonly row = signal(this.#context?.row);
  protected readonly detailsId = `cpk-tool-call-details-${nextId++}`;
  protected readonly labels = injectChatLabels();
  protected readonly rowStatusLabelKeys = toolCallRowStatusLabelKeys;
  protected readonly ChevronRightIcon = ChevronRight;

  protected readonly expanded = signal(false);
  protected readonly name = computed(() => this.toolCall().name || "Tool call");
  protected readonly argumentsText = computed(() =>
    safeToolValue(this.toolCall().args ?? {}),
  );
  protected readonly resultText = computed(() =>
    safeToolValue(this.toolCall().result),
  );
  protected readonly argsAttr = computed(() =>
    ɵstringifyToolCallAttr(this.toolCall().args),
  );
  protected readonly resultAttr = computed(() =>
    ɵstringifyToolCallAttr(this.toolCall().result),
  );
  protected readonly preview = computed(() =>
    ɵgetArgumentPreview(this.toolCall().args),
  );
  protected readonly statusValue = computed(() =>
    ɵnormalizeToolCallStatus(this.toolCall().status),
  );
  readonly #badge = computed(() => ɵgetToolCallBadge(this.statusValue()));
  /** Colors the status dot and badge: running, done, or anything else. */
  protected readonly tone = computed(() => this.#badge().tone);
  protected readonly statusLabel = computed(
    () => this.labels[this.#badge().labelKey],
  );
  protected readonly chevronClass = computed(() =>
    cn(
      "cpk-default-tool-call-chevron",
      this.expanded() && "cpk-default-tool-call-chevron-open",
    ),
  );
  protected readonly rowChevronClass = computed(() =>
    cn(
      "cpk-tool-call-chevron cpk-tool-call-row-chevron",
      this.expanded() && "cpk-tool-call-chevron-open",
    ),
  );

  protected toggleExpanded(): void {
    this.expanded.update((value) => !value);
  }
}
