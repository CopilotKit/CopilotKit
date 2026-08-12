import {
  Component,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";

import { cn } from "../../utils";

/**
 * Feather component for CopilotChatView
 * Creates a gradient overlay effect between messages and input
 * Matches React implementation exactly with same Tailwind classes
 */
@Component({
  selector: "copilot-chat-view-feather",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div [class]="computedClass" [style]="style()"></div>
  `,
})
export class CopilotChatViewFeather {
  inputClass = input<string | undefined>();
  style = input<{ [key: string]: any } | undefined>();

  // Computed class matching React exactly
  get computedClass(): string {
    return cn(
      // Positioning
      "cpk:absolute cpk:bottom-0 cpk:left-0 cpk:right-4 cpk:h-24 cpk:pointer-events-none cpk:z-10",
      // Gradient
      "cpk:bg-gradient-to-t",
      // Light mode colors
      "cpk:from-white cpk:via-white cpk:to-transparent",
      // Dark mode colors
      "cpk:dark:from-[rgb(33,33,33)] cpk:dark:via-[rgb(33,33,33)]",
      // Custom classes
      this.inputClass(),
    );
  }
}
