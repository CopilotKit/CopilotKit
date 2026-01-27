import {
  Component,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  forwardRef,
  ElementRef,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { CopilotSlot } from "../../slots/copilot-slot";
import { CopilotChatInput } from "./copilot-chat-input";
import { CopilotChatViewDisclaimer } from "./copilot-chat-view-disclaimer";
import { cn } from "../../utils";

/**
 * InputContainer component for CopilotChatView
 * Container for input and disclaimer components
 * Uses ForwardRef for DOM access
 */
@Component({
  standalone: true,
  selector: "copilot-chat-view-input-container",
  imports: [CommonModule, CopilotSlot],
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
      <!-- Input component -->
      <div class="max-w-3xl mx-auto py-0 px-4 sm:px-0">
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
      "absolute bottom-0 left-0 right-0 z-20",
      this.inputContainerClass()
    );
  }
}
