import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  signal,
  untracked,
} from "@angular/core";
import type { Message, ReasoningMessage } from "@ag-ui/core";
import { cn } from "../../utils";
import { CopilotChatAssistantMessageRenderer } from "./copilot-chat-assistant-message-renderer";
import { formatReasoningDuration } from "./copilot-chat-reasoning-message-utils";

@Component({
  selector: "copilot-chat-reasoning-message",
  imports: [CopilotChatAssistantMessageRenderer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      [class]="computedClass()"
      [attr.data-message-id]="message().id"
      data-testid="copilot-chat-reasoning-message"
    >
      <button
        type="button"
        [class]="headerClass()"
        [attr.aria-expanded]="hasContent() ? open() : null"
        (click)="toggle()"
      >
        <span class="cpk:font-medium">{{ label() }}</span>
        @if (isStreaming() && !hasContent()) {
          <span class="cpk:inline-flex cpk:items-center cpk:ml-1">
            <span
              class="cpk:w-1.5 cpk:h-1.5 cpk:rounded-full cpk:bg-muted-foreground cpk:animate-pulse"
            ></span>
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
          class="cpk:grid cpk:transition-[grid-template-rows] cpk:duration-200 cpk:ease-in-out"
          [style.grid-template-rows]="open() ? '1fr' : '0fr'"
        >
          <div class="cpk:overflow-hidden">
            <div class="cpk:pb-2 cpk:pt-1">
              <div class="cpk:text-sm cpk:text-muted-foreground">
                <copilot-chat-assistant-message-renderer
                  [content]="reasoningContent()"
                  inputClass="cpk:text-sm cpk:text-muted-foreground cpk:leading-relaxed cpk:[&_p]:m-0 cpk:[&_p+p]:mt-2 cpk:[&_strong]:font-semibold cpk:[&_strong]:text-foreground cpk:[&_ul]:my-1 cpk:[&_ol]:my-1 cpk:[&_li]:ml-4"
                ></copilot-chat-assistant-message-renderer>
                @if (isStreaming() && hasContent()) {
                  <span
                    class="cpk:inline-flex cpk:items-center cpk:ml-1 cpk:align-middle"
                  >
                    <span
                      class="cpk:w-2 cpk:h-2 cpk:rounded-full cpk:bg-muted-foreground cpk:animate-pulse-cursor"
                    ></span>
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

  protected readonly label = computed(() => {
    const start = this.startTime();
    if (this.isStreaming()) return "Thinking…";
    const seconds = start === undefined ? 0 : (Date.now() - start) / 1000;
    return `Thought for ${formatReasoningDuration(seconds)}`;
  });

  protected readonly computedClass = computed(() =>
    cn("cpk:my-1", this.inputClass()),
  );

  protected readonly headerClass = computed(() =>
    cn(
      "cpk:inline-flex cpk:items-center cpk:gap-1 cpk:py-1 cpk:text-sm cpk:text-muted-foreground cpk:transition-colors cpk:select-none",
      this.hasContent()
        ? "cpk:hover:text-foreground cpk:cursor-pointer"
        : "cpk:cursor-default",
    ),
  );

  protected readonly chevronClass = computed(() =>
    cn(
      "cpk:size-3.5 cpk:shrink-0 cpk:transition-transform cpk:duration-200",
      this.open() && "cpk:rotate-90",
    ),
  );

  protected toggle(): void {
    if (!this.hasContent()) return;
    this.userToggled.set(true);
    this.open.update((value) => !value);
  }
}
