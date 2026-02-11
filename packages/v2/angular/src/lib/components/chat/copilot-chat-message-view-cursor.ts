import {
  Component,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  computed,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { cn } from "../../utils";

/**
 * Cursor component that matches the React implementation exactly.
 * Shows a pulsing dot animation to indicate activity.
 */
@Component({
  selector: "copilot-chat-message-view-cursor",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: ` <div [class]="computedClass()"></div> `,
})
export class CopilotChatMessageViewCursor {
  inputClass = input<string | undefined>();

  // Computed class that matches React exactly: w-[11px] h-[11px] rounded-full bg-foreground animate-pulse-cursor ml-1
  computedClass = computed(() =>
    cn(
      "w-[11px] h-[11px] rounded-full bg-foreground animate-pulse-cursor ml-1",
      this.inputClass()
    )
  );
}
