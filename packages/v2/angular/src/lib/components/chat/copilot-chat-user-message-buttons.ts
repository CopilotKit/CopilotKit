import {
  Component,
  input,
  output,
  signal,
  computed,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { LucideAngularModule, Copy, Check, Edit } from "lucide-angular";
import { CopilotTooltip } from "../../directives/tooltip";
import { cn } from "../../utils";
import { injectChatLabels } from "../../chat-config";

// Base toolbar button component
@Component({
  selector: "button[copilotChatUserMessageToolbarButton]",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: ` <ng-content></ng-content> `,
  host: {
    "[class]": "computedClass()",
    "[attr.disabled]": "disabled() ? true : null",
    type: "button",
    "[attr.aria-label]": "title()",
  },
  hostDirectives: [
    {
      directive: CopilotTooltip,
      inputs: ["copilotTooltip: title", "tooltipPosition", "tooltipDelay"],
    },
  ],
})
export class CopilotChatUserMessageToolbarButton {
  title = input<string>("");
  disabled = input<boolean>(false);
  inputClass = input<string | undefined>();

  computedClass = computed(() => {
    return cn(
      // Flex centering
      "inline-flex items-center justify-center",
      // Cursor
      "cursor-pointer",
      // Background and text
      "p-0 text-[rgb(93,93,93)] hover:bg-[#E8E8E8]",
      // Dark mode
      "dark:text-[rgb(243,243,243)] dark:hover:bg-[#303030]",
      // Shape and sizing
      "h-8 w-8 rounded-md",
      // Interactions
      "transition-colors",
      // Hover states
      "hover:text-[rgb(93,93,93)]",
      "dark:hover:text-[rgb(243,243,243)]",
      // Focus states
      "focus:outline-none focus:ring-2 focus:ring-offset-2",
      // Disabled state
      "disabled:opacity-50 disabled:cursor-not-allowed",
      this.inputClass()
    );
  });
}

// Copy button component
@Component({
  standalone: true,
  selector: "copilot-chat-user-message-copy-button",
  imports: [
    CommonModule,
    LucideAngularModule,
    CopilotChatUserMessageToolbarButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      copilotChatUserMessageToolbarButton
      [title]="title() || labels.userMessageToolbarCopyMessageLabel"
      [disabled]="disabled()"
      [inputClass]="inputClass()"
      (click)="handleCopy()"
    >
      @if (copied()) {
        <lucide-angular [img]="CheckIcon" [size]="18"></lucide-angular>
      } @else {
        <lucide-angular [img]="CopyIcon" [size]="18"></lucide-angular>
      }
    </button>
  `,
})
export class CopilotChatUserMessageCopyButton {
  readonly title = input<string | undefined>();
  readonly disabled = input<boolean>(false);
  readonly inputClass = input<string | undefined>();
  readonly content = input<string | undefined>();
  readonly clicked = output<void>();
  readonly CopyIcon = Copy;
  readonly CheckIcon = Check;
  readonly copied = signal(false);
  readonly labels = injectChatLabels();

  handleCopy(): void {
    if (!this.content()) return;

    // Set copied immediately for instant feedback
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);

    // Copy to clipboard (fire and forget)
    navigator.clipboard.writeText(this.content()!).then(
      () => this.clicked.emit(),
      (err) => {
        console.error("Failed to copy message:", err);
        this.copied.set(false);
      }
    );
  }
}

// Edit button component
@Component({
  selector: "copilot-chat-user-message-edit-button",
  standalone: true,
  imports: [
    CommonModule,
    LucideAngularModule,
    CopilotChatUserMessageToolbarButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      copilotChatUserMessageToolbarButton
      [title]="title() || labels.userMessageToolbarEditMessageLabel"
      [disabled]="disabled()"
      [inputClass]="inputClass()"
      (click)="handleEdit()"
    >
      <lucide-angular [img]="EditIcon" [size]="18"></lucide-angular>
    </button>
  `,
})
export class CopilotChatUserMessageEditButton {
  title = input<string | undefined>();
  disabled = input<boolean>(false);
  inputClass = input<string | undefined>();
  clicked = output<void>();

  readonly EditIcon = Edit;
  readonly labels = injectChatLabels();

  handleEdit(): void {
    if (!this.disabled()) {
      this.clicked.emit();
    }
  }
}
