import {
  Component,
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
import { hostStyles } from "../host-styles";

/**
 * InputContainer component for CopilotChatView
 * Container for input and disclaimer components
 * Uses ForwardRef for DOM access
 */
@Component({
  selector: "copilot-chat-view-input-container",
  imports: [CopilotSlot, CopilotChatAttachmentQueue],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: [hostStyles],
  providers: [
    {
      provide: ElementRef,
      useExisting: forwardRef(() => CopilotChatViewInputContainer),
    },
  ],
  template: `
    <div data-testid="copilot-input-overlay" [class]="computedClass">
      @if ((chatState?.attachments() ?? []).length > 0) {
        <div class="cpk-chat-view-attachments">
          <copilot-chat-attachment-queue
            [attachments]="chatState?.attachments() ?? []"
            inputClass="cpk-chat-view-attachment-queue"
            (removeAttachment)="chatState?.removeAttachment($event)"
          />
        </div>
      }

      <copilot-slot
        [slot]="input()"
        [context]="{ inputClass: inputClass() }"
        [defaultComponent]="defaultInputComponent"
      >
      </copilot-slot>

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
    return cn("cpk-chat-view-input-overlay", this.inputContainerClass());
  }
}
