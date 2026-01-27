import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { LucideAngularModule, ChevronDown } from "lucide-angular";
import { cn } from "../../utils";

/**
 * ScrollToBottomButton component for CopilotChatView
 * Matches React implementation exactly with same Tailwind classes
 */
@Component({
  standalone: true,
  selector: "copilot-chat-view-scroll-to-bottom-button",
  imports: [CommonModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      type="button"
      [class]="computedClass"
      [disabled]="disabled()"
      (click)="handleClick()"
    >
      <lucide-angular
        [img]="ChevronDown"
        class="w-4 h-4 text-gray-600 dark:text-white"
      >
      </lucide-angular>
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
      "rounded-full w-10 h-10 p-0",
      // Background colors
      "bg-white dark:bg-gray-900",
      // Border and shadow
      "shadow-lg border border-gray-200 dark:border-gray-700",
      // Hover states
      "hover:bg-gray-50 dark:hover:bg-gray-800",
      // Layout
      "flex items-center justify-center cursor-pointer",
      // Transition
      "transition-colors",
      // Focus states
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
      // Custom classes
      this.inputClass()
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
