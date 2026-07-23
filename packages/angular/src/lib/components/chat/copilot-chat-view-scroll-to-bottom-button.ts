import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";

import { ChevronDown, CopilotIcon } from "../icons/copilot-icon";
import { cn } from "../../utils";

/**
 * ScrollToBottomButton component for CopilotChatView
 * Matches React implementation exactly with same Tailwind classes
 */
@Component({
  selector: "copilot-chat-view-scroll-to-bottom-button",
  imports: [CopilotIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      type="button"
      aria-label="Scroll to bottom"
      [class]="computedClass"
      [disabled]="disabled()"
      (click)="handleClick()"
    >
      <copilot-icon
        [img]="ChevronDown"
        class="cpk:w-4 cpk:h-4 cpk:text-gray-600 cpk:dark:text-white"
      >
      </copilot-icon>
    </button>
  `,
})
export class CopilotChatViewScrollToBottomButton {
  inputClass = input<string | undefined>();
  disabled = input<boolean>(false);
  // Support function-style click handler via slot context
  onClick = input<(() => void) | undefined>();

  // Simple, idiomatic Angular output
  clicked = output<void>();

  // Icon reference
  protected readonly ChevronDown = ChevronDown;

  // Computed class matching React exactly
  get computedClass(): string {
    return cn(
      // Base button styles
      "cpk:rounded-full cpk:w-10 cpk:h-10 cpk:p-0",
      // Background colors
      "cpk:bg-white cpk:dark:bg-gray-900",
      // Border and shadow
      "cpk:shadow-lg cpk:border cpk:border-gray-200 cpk:dark:border-gray-700",
      // Hover states
      "cpk:hover:bg-gray-50 cpk:dark:hover:bg-gray-800",
      // Layout
      "cpk:flex cpk:items-center cpk:justify-center cpk:cursor-pointer",
      // Transition
      "cpk:transition-colors",
      // Focus states
      "cpk:focus:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-offset-2",
      // Custom classes
      this.inputClass(),
    );
  }

  handleClick(): void {
    if (!this.disabled()) {
      // Call input handler if provided (slot-style)
      if (this.onClick()) {
        this.onClick()!();
      }
      this.clicked.emit();
    }
  }
}
