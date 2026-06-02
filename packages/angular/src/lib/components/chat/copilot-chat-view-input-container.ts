import {
  Component,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  forwardRef,
  ElementRef,
  inject,
} from "@angular/core";
import { CommonModule } from "@angular/common";
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
  standalone: true,
  selector: "copilot-chat-view-input-container",
  imports: [
    CommonModule,
    CopilotSlot,
    CopilotChatAttachmentQueue,
    CopilotChatSuggestionView,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  providers: [
    {
      provide: ElementRef,
      useExisting: forwardRef(() => CopilotChatViewInputContainer),
    },
  ],
  template: `
    <div [class]="computedClass">
      @if ((chatState?.suggestions?.() ?? []).length > 0) {
        <div
          class="cpk:max-w-3xl cpk:mx-auto cpk:w-full cpk:pointer-events-auto cpk:px-4 cpk:sm:px-0 cpk:pb-2"
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
      @if ((chatState?.attachments?.() ?? []).length > 0) {
        <div class="cpk:max-w-3xl cpk:mx-auto cpk:w-full cpk:pointer-events-auto">
          <copilot-chat-attachment-queue
            [attachments]="chatState?.attachments?.() ?? []"
            inputClass="cpk:px-4"
            (removeAttachment)="chatState?.removeAttachment($event)"
          />
        </div>
      }

      <div class="cpk:max-w-3xl cpk:mx-auto cpk:py-0 cpk:px-4 cpk:sm:px-0">
        <copilot-slot
          [slot]="input()"
          [context]="{ inputClass: inputClass() }"
          [defaultComponent]="defaultInputComponent"
        >
        </copilot-slot>
      </div>

      <!-- Disclaimer - always rendered like in React -->
      <copilot-slot
        [slot]="disclaimer()"
        [context]="{ text: disclaimerText(), inputClass: disclaimerClass() }"
        [defaultComponent]="defaultDisclaimerComponent"
      >
      </copilot-slot>
    </div>
  `,
})
export class CopilotChatViewInputContainer extends ElementRef {
  readonly chatState = inject(ChatState, { optional: true });

  inputContainerClass = input<string | undefined>();

  // Input slot configuration
  input = input<any | undefined>();
  inputClass = input<string | undefined>();

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
      "cpk:absolute cpk:bottom-0 cpk:left-0 cpk:right-0 cpk:z-20",
      this.inputContainerClass(),
    );
  }
}
