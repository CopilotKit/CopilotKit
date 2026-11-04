import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  ViewEncapsulation,
} from "@angular/core";
import { hostStyles } from "../host-styles";
import type { Message, ReasoningMessage } from "@ag-ui/core";
import {
  ɵgetReasoningHeaderLabel,
  ɵReasoningDisclosure,
} from "@copilotkit/core";
import { cn } from "../../utils";
import { CopilotChatAssistantMessageRenderer } from "./copilot-chat-assistant-message-renderer";
import { injectChatLabels } from "../../chat-config";
import { ChevronRight, CopilotIcon } from "../icons/copilot-icon";

@Component({
  selector: "copilot-chat-reasoning-message",
  imports: [CopilotChatAssistantMessageRenderer, CopilotIcon],
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
          <copilot-icon
            [img]="ChevronRightIcon"
            [iconClass]="chevronClass()"
          ></copilot-icon>
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
  protected readonly ChevronRightIcon = ChevronRight;

  protected readonly isLatest = computed(() => {
    const messages = this.messages();
    return messages[messages.length - 1]?.id === this.message().id;
  });

  protected readonly isStreaming = computed(
    () => this.isRunning() && this.isLatest(),
  );

  // Open while streaming, auto-collapse when it ends unless the user
  // toggled, and the elapsed time: see core's ɵReasoningDisclosure.
  // Inputs are not set yet here; the effect below passes the first state.
  readonly #disclosure = new ɵReasoningDisclosure();
  readonly #disclosureState = signal(this.#disclosure.getSnapshot());

  protected readonly open = computed(() => this.#disclosureState().isOpen);

  protected readonly hasContent = computed(
    // Untyped data can leave `content` out.
    () => (this.message().content || "").length > 0,
  );

  protected readonly reasoningContent = computed(
    () => this.message().content || "",
  );

  /**
   * `labels.reasoningMessageThinkingLabel` while streaming, then
   * `labels.reasoningMessageThoughtForLabel` ("Thought for 4 seconds").
   */
  protected readonly label = computed(() =>
    ɵgetReasoningHeaderLabel(
      {
        isStreaming: this.isStreaming(),
        elapsedSeconds: this.#disclosureState().elapsedSeconds,
      },
      this.labels,
    ),
  );

  constructor() {
    const unsubscribe = this.#disclosure.subscribe(() =>
      this.#disclosureState.set(this.#disclosure.getSnapshot()),
    );
    effect(() => this.#disclosure.setStreaming(this.isStreaming()));
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      this.#disclosure.dispose();
    });
  }

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
    this.#disclosure.toggle();
  }
}
