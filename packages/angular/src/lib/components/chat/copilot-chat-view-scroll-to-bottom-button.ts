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
      data-testid="copilot-scroll-to-bottom"
      [class]="computedClass"
      [disabled]="disabled()"
      (click)="handleClick()"
    >
      <copilot-icon [img]="ChevronDown" [size]="16" />
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
      "cpk:rounded-full cpk:size-9 cpk:p-0 cpk:pointer-events-auto",
      // Surface, border and shadow follow CopilotKit's tokens
      "cpk:border cpk:border-border cpk:bg-background cpk:text-foreground cpk:dark:bg-card",
      "cpk:shadow-[0_2px_8px_-2px_rgb(0_0_0/0.12)]",
      // Hover states
      "cpk:hover:bg-accent cpk:dark:hover:bg-accent",
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
