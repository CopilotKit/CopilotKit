import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  signal,
  untracked,
  ViewEncapsulation,
} from "@angular/core";
import { hostStyles } from "../host-styles";
import type { Message, ReasoningMessage } from "@ag-ui/core";
import {
  ɵformatLabel,
  ɵformatReasoningDuration,
  ɵformatCountLabel,
} from "@copilotkit/core";
import type { CopilotChatLabels } from "@copilotkit/core";
import { cn } from "../../utils";
import { CopilotChatAssistantMessageRenderer } from "./copilot-chat-assistant-message-renderer";
import { injectChatLabels } from "../../chat-config";

/**
 * The reasoning time as label text, such as "4 seconds" or "1m 5s".
 *
 * @param seconds - The elapsed time in seconds. It may have a fraction.
 * @param labels - The chat labels that hold the duration texts.
 */
function formatDuration(seconds: number, labels: CopilotChatLabels) {
  const duration = ɵformatReasoningDuration(seconds);
  switch (duration.unit) {
    case "fewSeconds":
      return labels.reasoningMessageDurationFewSeconds;
    case "seconds":
      return ɵformatLabel(labels.reasoningMessageDurationSeconds, {
        count: duration.seconds,
      });
    case "minutes":
      return ɵformatCountLabel(duration.minutes, {
        one: labels.reasoningMessageDurationMinutesOne,
        other: labels.reasoningMessageDurationMinutesOther,
      });
    case "minutesSeconds":
      return ɵformatLabel(labels.reasoningMessageDurationMinutesSeconds, {
        minutes: duration.minutes,
        seconds: duration.seconds,
      });
  }
}

@Component({
  selector: "copilot-chat-reasoning-message",
  imports: [CopilotChatAssistantMessageRenderer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: [hostStyles],
  template: `
    <div
      [class]="computedClass()"
      [attr.data-message-id]="message().id"
      data-testid="copilot-chat-reasoning-message"
      data-copilot-reasoning-message
    >
      <button
        type="button"
        data-testid="reasoning-block"
        [class]="headerClass()"
        [attr.aria-expanded]="hasContent() ? open() : null"
        (click)="toggle()"
      >
        <span class="cpk-reasoning-message-label">{{ label() }}</span>
        @if (isStreaming() && !hasContent()) {
          <span class="cpk-reasoning-message-indicator">
            <span class="cpk-reasoning-message-indicator-dot"></span>
          </span>
        }
        @if (hasContent()) {
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            [class]="chevronClass()"
          >
            <path d="m9 18 6-6-6-6"></path>
          </svg>
        }
      </button>

      @if (hasContent() || isStreaming()) {
        <div
          class="cpk-reasoning-message-toggle"
          [style.grid-template-rows]="open() ? '1fr' : '0fr'"
        >
          <div class="cpk-reasoning-message-toggle-content">
            <div class="cpk-reasoning-message-content">
              <div class="cpk-reasoning-message-text">
                <copilot-chat-assistant-message-renderer
                  [content]="reasoningContent()"
                ></copilot-chat-assistant-message-renderer>
                @if (isStreaming() && hasContent()) {
                  <span class="cpk-reasoning-message-cursor">
                    <span class="cpk-reasoning-message-cursor-dot"></span>
                  </span>
                }
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class CopilotChatReasoningMessage {
  readonly message = input.required<ReasoningMessage>();
  readonly messages = input<Message[]>([]);
  readonly isRunning = input<boolean>(false);
  readonly inputClass = input<string | undefined>();
  private readonly labels = injectChatLabels();

  private readonly userToggled = signal(false);

  protected readonly isLatest = computed(() => {
    const messages = this.messages();
    return messages[messages.length - 1]?.id === this.message().id;
  });

  protected readonly isStreaming = computed(
    () => this.isRunning() && this.isLatest(),
  );

  // Captures the wall-clock start the moment streaming begins and holds it
  // afterwards. `label` reads this in both branches, keeping the linkedSignal
  // warm so it recomputes across the streaming transition (no effect needed).
  private readonly startTime = linkedSignal<boolean, number | undefined>({
    source: this.isStreaming,
    computation: (streaming, prev) =>
      streaming ? (prev?.value ?? Date.now()) : prev?.value,
  });

  // Opens automatically while streaming. Once the user toggles, their choice is
  // respected; otherwise the panel auto-collapses when streaming ends. Reads
  // userToggled untracked so a mid-stream toggle doesn't re-force it open.
  protected readonly open = linkedSignal<boolean, boolean>({
    source: this.isStreaming,
    computation: (streaming, prev) =>
      streaming
        ? true
        : untracked(() => this.userToggled())
          ? (prev?.value ?? false)
          : false,
  });

  protected readonly hasContent = computed(
    () => (this.message().content?.length ?? 0) > 0,
  );

  protected readonly reasoningContent = computed(
    () => this.message().content ?? "",
  );

  /**
   * `labels.reasoningMessageThinkingLabel` while streaming, then
   * `labels.reasoningMessageThoughtForLabel` ("Thought for 4 seconds").
   */
  protected readonly label = computed(() => {
    const start = this.startTime();
    if (this.isStreaming()) return this.labels.reasoningMessageThinkingLabel;
    const seconds = start === undefined ? 0 : (Date.now() - start) / 1000;
    return ɵformatLabel(this.labels.reasoningMessageThoughtForLabel, {
      duration: formatDuration(seconds, this.labels),
    });
  });

  protected readonly computedClass = computed(() =>
    cn("cpk-reasoning-message", this.inputClass()),
  );

  protected readonly headerClass = computed(() =>
    cn(
      "cpk-reasoning-message-header",
      this.hasContent() && "cpk-reasoning-message-header-expandable",
    ),
  );

  protected readonly chevronClass = computed(() =>
    cn(
      "cpk-reasoning-message-chevron",
      this.open() && "cpk-reasoning-message-chevron-open",
    ),
  );

  protected toggle(): void {
    if (!this.hasContent()) return;
    this.userToggled.set(true);
    this.open.update((value) => !value);
  }
}
