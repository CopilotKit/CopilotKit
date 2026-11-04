import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  effect,
  input,
  signal,
} from "@angular/core";
import { ɵgetWorkSummaryText } from "@copilotkit/core";
import type { ToolCallEntry } from "@copilotkit/core";
import { ChevronRight, CopilotIcon } from "../icons/copilot-icon";
import { injectChatLabels } from "../../chat-config";
import { cn } from "../../utils";

/**
 * The line at the top of a reply in the `"turn"` tool-call display, like
 * React's `CopilotChatWorkSummary`. While the agent works it reads "Working
 * 4s". Once the reply is done it reads "Worked for 9s" and "7 tools". The
 * message view toggles the work it folded away when the button is clicked.
 * The text comes from the `workSummary...` and `toolCall...` chat labels.
 */
@Component({
  selector: "copilot-chat-work-summary",
  imports: [CopilotIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { style: "display: contents" },
  template: `
    <button
      type="button"
      data-copilotkit
      data-testid="copilot-work-summary"
      [attr.data-state]="isWorking() ? 'working' : 'done'"
      [attr.aria-expanded]="isOpen()"
      [class]="buttonClass()"
    >
      <span [class]="labelClass()">{{ text().label }}</span>
      @if (text().detail !== null) {
        <span [class]="detailClass()">{{ text().detail }}</span>
      }
      @if (text().failed !== null) {
        <span class="cpk-work-summary-failed">{{ text().failed }}</span>
      }
      <copilot-icon
        aria-hidden="true"
        [img]="ChevronRightIcon"
        [iconClass]="chevronClass()"
      />
    </button>
  `,
})
export class CopilotChatWorkSummary {
  /** The agent is still working on this reply. */
  readonly isWorking = input(false);
  /** Whether the work (narration and tool calls) is showing. */
  readonly isOpen = input(false);
  /** The tool calls the reply made. */
  readonly calls = input<ToolCallEntry[]>([]);
  /**
   * How long the agent has worked on the reply, in ms, summed over its runs.
   * Only known for replies this client watched start; without it the summary
   * shows the tool count.
   */
  readonly elapsedMs = input<number | undefined>();
  /** When the current run started (epoch ms), while the agent is working. */
  readonly workingSince = input<number | undefined>();
  readonly inputClass = input<string | undefined>();

  protected readonly ChevronRightIcon = ChevronRight;
  readonly #labels = injectChatLabels();
  // The current time, updated every second while the agent works.
  readonly #now = signal(Date.now());

  constructor() {
    effect((onCleanup) => {
      if (!this.isWorking()) return;
      this.#now.set(Date.now());
      const timer = setInterval(() => this.#now.set(Date.now()), 1000);
      onCleanup(() => clearInterval(timer));
    });
  }

  protected readonly text = computed(() =>
    ɵgetWorkSummaryText({
      isWorking: this.isWorking(),
      calls: this.calls(),
      elapsedMs: this.elapsedMs(),
      workingSince: this.workingSince(),
      now: this.#now(),
      labels: this.#labels,
    }),
  );
  protected readonly buttonClass = computed(() =>
    cn("cpk-work-summary", this.inputClass()),
  );
  protected readonly labelClass = computed(() =>
    cn("cpk-work-summary-label", this.isWorking() && "cpk-shimmer"),
  );
  protected readonly detailClass = computed(() =>
    cn("cpk-work-summary-detail", this.isWorking() && "cpk-work-summary-timer"),
  );
  protected readonly chevronClass = computed(() =>
    cn(
      "cpk-work-summary-chevron",
      this.isOpen() && "cpk-work-summary-chevron-open",
    ),
  );
}
