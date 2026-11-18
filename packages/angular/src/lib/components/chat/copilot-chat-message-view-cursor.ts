import {
  Component,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  computed,
} from "@angular/core";

import { cn } from "../../utils";

/**
 * Cursor component that matches the React implementation exactly.
 * Shows a pulsing dot animation to indicate activity.
 */
@Component({
  selector: "copilot-chat-message-view-cursor",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div data-testid="copilot-loading-cursor" [class]="computedClass()"></div>
  `,
})
export class CopilotChatMessageViewCursor {
  inputClass = input<string | undefined>();

  computedClass = computed(() =>
    cn("cpk-message-view-cursor", this.inputClass()),
  );
}
