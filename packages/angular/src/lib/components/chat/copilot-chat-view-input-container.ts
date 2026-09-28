import {
  Component,
  computed,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  forwardRef,
  ElementRef,
  inject,
} from "@angular/core";

import { CopilotSlot } from "../../slots/copilot-slot";
import { CopilotChatInput } from "./copilot-chat-input";
import { CopilotChatViewDisclaimer } from "./copilot-chat-view-disclaimer";
import { cn } from "../../utils";
import { ChatState } from "../../chat-state";
import { CopilotChatAttachmentQueue } from "./copilot-chat-attachment-queue";
import { CopilotChatSuggestionView } from "./copilot-chat-suggestion-view";

/**
 * InputContainer component for CopilotChatView
 * Container for input and disclaimer components
 * Uses ForwardRef for DOM access
 */
@Component({
  selector: "copilot-chat-view-input-container",
  imports: [CopilotSlot, CopilotChatAttachmentQueue, CopilotChatSuggestionView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  providers: [
    {
      provide: ElementRef,
      useExisting: forwardRef(() => CopilotChatViewInputContainer),
    },
  ],
  template: `
    <div data-testid="copilot-input-overlay" [class]="computedClass">
      <!-- Messages fade out above the input and are fully hidden by the time
           they reach it, including the disclaimer area below. -->
      <div
        aria-hidden="true"
        class="cpk:pointer-events-none cpk:absolute cpk:inset-x-0 cpk:-top-6 cpk:bottom-0 cpk:-z-10 cpk:bg-[linear-gradient(to_bottom,transparent,var(--background)_1.5rem)]"
      ></div>
      <!-- Suggestions: one scrollable row docked above the input -->
      @if (showSuggestions() && (chatState?.suggestions?.() ?? []).length > 0) {
        <div
          class="cpk:max-w-3xl cpk:mx-auto cpk:w-full cpk:mb-1.5 cpk:px-4 cpk:@3xl:px-0 cpk:[div[data-sidebar-chat]_&]:px-8 cpk:[div[data-popup-chat]_&]:px-4 cpk:pointer-events-auto"
        >
          <copilot-chat-suggestion-view
            [suggestions]="chatState?.suggestions?.() ?? []"
            (selectSuggestion)="
              chatState?.selectSuggestion($event.suggestion, $event.index)
            "
          />
        </div>
      }

      <!-- Input component -->
      @if ((chatState?.attachments() ?? []).length > 0) {
        <div class="cpk:max-w-3xl cpk:mx-auto cpk:w-full cpk:pointer-events-auto">
          <copilot-chat-attachment-queue
            [attachments]="chatState?.attachments() ?? []"
            inputClass="cpk:px-4"
            (removeAttachment)="chatState?.removeAttachment($event)"
          />
        </div>
      }

      <div
        class="cpk:max-w-3xl cpk:mx-auto cpk:py-0 cpk:px-4 cpk:@3xl:px-0 cpk:[div[data-sidebar-chat]_&]:px-8 cpk:[div[data-popup-chat]_&]:px-4 cpk:pointer-events-auto"
      >
        <copilot-slot
          [slot]="input()"
          [context]="inputContext()"
          [defaultComponent]="defaultInputComponent"
        >
        </copilot-slot>
      </div>

      <!-- Disclaimer - always rendered like in React; selectable and clickable
           although the overlay lets clicks through. -->
      <div class="cpk:pointer-events-auto">
        <copilot-slot
          [slot]="disclaimer()"
          [context]="{ text: disclaimerText(), inputClass: disclaimerClass() }"
          [defaultComponent]="defaultDisclaimerComponent"
        >
        </copilot-slot>
      </div>
    </div>
  `,
})
export class CopilotChatViewInputContainer extends ElementRef {
  readonly chatState = inject(ChatState, { optional: true });

  inputContainerClass = input<string | undefined>();
  /** Show the suggestion row above the input (hidden while a run is active). */
  showSuggestions = input<boolean>(true);

  // Input slot configuration
  input = input<any | undefined>();
  inputClass = input<string | undefined>();
  /** Forwarded to the input (see CopilotChatInput `textAreaMaxRows`). */
  textAreaMaxRows = input<number | undefined>();
  /** Forwarded to the input (see CopilotChatInput `highlightMarkdown`). */
  highlightMarkdown = input<boolean>(true);
  /** Forwarded to the input as its `layout` (see CopilotChatInput). */
  inputLayout = input<"auto" | "stacked">("auto");

  protected readonly inputContext = computed(() => ({
    inputClass: this.inputClass(),
    textAreaMaxRows: this.textAreaMaxRows(),
    highlightMarkdown: this.highlightMarkdown(),
    layout: this.inputLayout(),
  }));

  // Disclaimer slot configuration
  disclaimer = input<any | undefined>();
  disclaimerText = input<string | undefined>();
  disclaimerClass = input<string | undefined>();

  // Default components
  protected readonly defaultInputComponent = CopilotChatInput;
  protected readonly defaultDisclaimerComponent = CopilotChatViewDisclaimer;

  constructor(elementRef: ElementRef) {
    super(elementRef.nativeElement);
  }

  get computedClass(): string {
    return cn(
      "cpk:absolute cpk:bottom-0 cpk:left-0 cpk:right-0 cpk:z-20 cpk:pointer-events-none",
      this.inputContainerClass(),
    );
  }
}
