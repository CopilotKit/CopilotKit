import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import {
  Check,
  ChevronDown,
  LoaderCircle,
  LucideAngularModule,
  Wrench,
} from "lucide-angular";

import type { AngularToolCall, ToolRenderer } from "@copilotkit/angular";

type WildcardToolArgs = Record<string, unknown>;

type ToolEntry = {
  key: string;
  value: string;
};

@Component({
  selector: "wildcard-tool-render",
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="copilot-tool-reasoning" data-testid="wildcard-tool-render">
      <button
        type="button"
        class="copilot-tool-summary"
        [class.copilot-tool-summary--static]="!hasDetails()"
        [attr.aria-expanded]="hasDetails() ? open() : null"
        (click)="toggle()"
      >
        @if (isRunning()) {
          <lucide-angular
            [img]="LoaderCircleIcon"
            [size]="14"
            class="copilot-tool-icon copilot-tool-icon--spin"
          />
        } @else {
          <lucide-angular
            [img]="CheckIcon"
            [size]="14"
            class="copilot-tool-icon copilot-tool-icon--complete"
          />
        }

        <lucide-angular [img]="WrenchIcon" [size]="14" class="copilot-tool-icon" />

        <span class="copilot-tool-name">{{ toolName() }}</span>
        <span class="copilot-tool-status">{{ statusLabel() }}</span>

        @if (hasDetails()) {
          <lucide-angular
            [img]="ChevronDownIcon"
            [size]="14"
            class="copilot-tool-chevron"
            [class.copilot-tool-chevron--open]="open()"
          />
        }
      </button>

      @if (hasDetails()) {
        <div
          class="copilot-tool-details-wrap"
          [style.grid-template-rows]="open() ? '1fr' : '0fr'"
        >
          <div class="copilot-tool-details-clip">
            <div class="copilot-tool-details">
              @for (entry of entries(); track entry.key) {
                <div class="copilot-tool-entry">
                  <span class="copilot-tool-entry-key">{{ entry.key }}:</span>
                  <span class="copilot-tool-entry-value">{{ entry.value }}</span>
                </div>
              }

              @if (resultSummary(); as result) {
                <div class="copilot-tool-entry">
                  <span class="copilot-tool-entry-key">result:</span>
                  <span class="copilot-tool-entry-value">{{ result }}</span>
                </div>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .copilot-tool-reasoning {
        margin: 6px 0;
        color: var(--muted-foreground, #737373);
      }

      .copilot-tool-summary {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        border: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
        padding: 4px 0;
        font: inherit;
        font-size: 14px;
        text-align: left;
        transition: color 0.15s ease;
      }

      .copilot-tool-summary:hover {
        color: var(--foreground, #171717);
      }

      .copilot-tool-summary--static {
        cursor: default;
      }

      .copilot-tool-summary--static:hover {
        color: inherit;
      }

      .copilot-tool-icon {
        width: 14px;
        height: 14px;
        flex: 0 0 14px;
      }

      .copilot-tool-icon--spin {
        animation: copilot-tool-spin 1s linear infinite;
      }

      .copilot-tool-icon--complete {
        color: #10b981;
      }

      .copilot-tool-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--foreground, #171717);
        font-family:
          var(--font-code), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
          "Liberation Mono", "Courier New", monospace;
        font-weight: 500;
      }

      .copilot-tool-status {
        flex: 0 0 auto;
        font-size: 12px;
        color: var(--muted-foreground, #737373);
      }

      .copilot-tool-chevron {
        margin-left: auto;
        width: 14px;
        height: 14px;
        flex: 0 0 14px;
        transition: transform 0.2s ease;
      }

      .copilot-tool-chevron--open {
        transform: rotate(180deg);
      }

      .copilot-tool-details-wrap {
        display: grid;
        transition: grid-template-rows 0.2s ease;
      }

      .copilot-tool-details-clip {
        overflow: hidden;
      }

      .copilot-tool-details {
        margin: 6px 0 0 22px;
        padding: 8px 12px;
        display: grid;
        gap: 4px;
        border-radius: 6px;
        background: var(--secondary, #f5f5f5);
      }

      .copilot-tool-entry {
        min-width: 0;
        display: flex;
        gap: 8px;
        font-family:
          var(--font-code), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
          "Liberation Mono", "Courier New", monospace;
        font-size: 12px;
        line-height: 1.4;
      }

      .copilot-tool-entry-key {
        flex: 0 0 auto;
        color: var(--muted-foreground, #737373);
      }

      .copilot-tool-entry-value {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--foreground, #171717);
      }

      @keyframes copilot-tool-spin {
        from {
          transform: rotate(0deg);
        }

        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class WildcardToolRenderComponent implements ToolRenderer<WildcardToolArgs> {
  readonly toolCall = input.required<AngularToolCall<WildcardToolArgs>>();

  protected readonly LoaderCircleIcon = LoaderCircle;
  protected readonly CheckIcon = Check;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly WrenchIcon = Wrench;

  protected readonly isRunning = computed(
    () => this.toolCall().status !== "complete",
  );

  protected readonly open = linkedSignal(() => this.isRunning());

  protected readonly toolName = computed(() => this.toolCall().name ?? "tool");

  protected readonly entries = computed<ToolEntry[]>(() =>
    Object.entries(this.toolCall().args ?? {}).map(([key, value]) => ({
      key,
      value: this.formatValue(value),
    })),
  );

  protected readonly resultSummary = computed(() => {
    const toolCall = this.toolCall();
    if (toolCall.status !== "complete") return undefined;
    if (!toolCall.result) return undefined;
    return this.formatValue(toolCall.result);
  });

  protected readonly hasDetails = computed(
    () => this.entries().length > 0 || this.resultSummary() !== undefined,
  );

  protected readonly statusLabel = computed(() =>
    this.isRunning() ? "Running" : "Complete",
  );

  private formatValue(value: unknown): string {
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === "object" && value !== null) {
      return `{${Object.keys(value).length} keys}`;
    }
    if (typeof value === "string") return `"${value}"`;
    if (value === undefined) return "undefined";
    return String(value);
  }

  protected toggle(): void {
    if (!this.hasDetails()) return;
    this.open.update((value) => !value);
  }
}
