import {
  Component,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";

import { cn } from "../..//utils";
import { injectChatLabels } from "../../chat-config";

/**
 * Disclaimer component for CopilotChatView
 * Shows configurable disclaimer text below the input
 * Integrates with CopilotChatConfigurationService for labels
 */
@Component({
  selector: "copilot-chat-view-disclaimer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div [class]="computedClass">
      {{ disclaimerText }}
    </div>
  `,
})
export class CopilotChatViewDisclaimer {
  inputClass = input<string | undefined>();
  text = input<string | undefined>();

  readonly labels = injectChatLabels();

  // Get disclaimer text from input or configuration
  get disclaimerText(): string {
    if (this.text()) {
      return this.text() as string;
    }

    return this.labels.chatDisclaimerText;
  }

  // Computed class matching React exactly
  get computedClass(): string {
    return cn(
      "cpk:text-center cpk:text-xs cpk:text-muted-foreground cpk:py-3 cpk:px-4 cpk:max-w-3xl cpk:mx-auto",
      this.inputClass(),
    );
  }
}
