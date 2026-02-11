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
import {
  LucideAngularModule,
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  Volume2,
  RefreshCw,
} from "lucide-angular";
import { CopilotTooltip } from "../../directives/tooltip";
import { cn } from "../../utils";
import { injectChatLabels } from "../../chat-config";

// Base toolbar button component
@Component({
  standalone: true,
  selector: "button[copilotChatAssistantMessageToolbarButton]",
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
export class CopilotChatAssistantMessageToolbarButton {
  title = input<string>("");
  disabled = input<boolean>(false);
  inputClass = input<string | undefined>();

  computedClass = computed(() => {
    return cn(
      // Flex centering with gap (from React button base styles)
      "inline-flex items-center justify-center gap-2",
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
      // SVG styling from React Button component
      "[&_svg]:pointer-events-none [&_svg]:shrink-0",
      // Ensure proper sizing
      "shrink-0",
      this.inputClass()
    );
  });
}

// Copy button component
@Component({
  standalone: true,
  selector: "copilot-chat-assistant-message-copy-button",
  imports: [
    CommonModule,
    LucideAngularModule,
    CopilotChatAssistantMessageToolbarButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      copilotChatAssistantMessageToolbarButton
      [title]="title() || labels.assistantMessageToolbarCopyMessageLabel"
      [disabled]="disabled()"
      [inputClass]="inputClass()"
      (click)="handleCopy($event)"
    >
      @if (copied()) {
        <lucide-angular [img]="CheckIcon" [size]="18"></lucide-angular>
      } @else {
        <lucide-angular [img]="CopyIcon" [size]="18"></lucide-angular>
      }
    </button>
  `,
})
export class CopilotChatAssistantMessageCopyButton {
  readonly title = input<string | undefined>();
  readonly disabled = input<boolean>(false);
  readonly inputClass = input<string | undefined>();
  readonly content = input<string | undefined>();
  readonly clicked = output<void>();
  readonly CopyIcon = Copy;
  readonly CheckIcon = Check;
  readonly copied = signal(false);
  readonly labels = injectChatLabels();

  handleCopy(event?: Event): void {
    event?.stopPropagation();
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

// Thumbs up button component
@Component({
  standalone: true,
  selector: "copilot-chat-assistant-message-thumbs-up-button",
  imports: [
    CommonModule,
    LucideAngularModule,
    CopilotChatAssistantMessageToolbarButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      copilotChatAssistantMessageToolbarButton
      [title]="title() || labels.assistantMessageToolbarThumbsUpLabel"
      [disabled]="disabled()"
      [inputClass]="inputClass()"
      (click)="handleClick($event)"
    >
      <lucide-angular [img]="ThumbsUpIcon" [size]="18"></lucide-angular>
    </button>
  `,
})
export class CopilotChatAssistantMessageThumbsUpButton {
  readonly title = input<string | undefined>();
  readonly disabled = input<boolean>(false);
  readonly inputClass = input<string | undefined>();
  readonly clicked = output<void>();
  readonly ThumbsUpIcon = ThumbsUp;
  readonly labels = injectChatLabels();

  handleClick(event?: Event): void {
    event?.stopPropagation();
    if (!this.disabled()) {
      this.clicked.emit();
    }
  }
}

// Thumbs down button component
@Component({
  standalone: true,
  selector: "copilot-chat-assistant-message-thumbs-down-button",
  imports: [
    CommonModule,
    LucideAngularModule,
    CopilotChatAssistantMessageToolbarButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      copilotChatAssistantMessageToolbarButton
      [title]="title() || labels.assistantMessageToolbarThumbsDownLabel"
      [disabled]="disabled()"
      [inputClass]="inputClass()"
      (click)="handleClick($event)"
    >
      <lucide-angular [img]="ThumbsDownIcon" [size]="18"></lucide-angular>
    </button>
  `,
})
export class CopilotChatAssistantMessageThumbsDownButton {
  readonly title = input<string | undefined>();
  readonly disabled = input<boolean>(false);
  readonly inputClass = input<string | undefined>();
  readonly clicked = output<void>();
  readonly ThumbsDownIcon = ThumbsDown;
  readonly labels = injectChatLabels();

  handleClick(event?: Event): void {
    event?.stopPropagation();
    if (!this.disabled()) {
      this.clicked.emit();
    }
  }
}

// Read aloud button component
@Component({
  standalone: true,
  selector: "copilot-chat-assistant-message-read-aloud-button",
  imports: [
    CommonModule,
    LucideAngularModule,
    CopilotChatAssistantMessageToolbarButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      copilotChatAssistantMessageToolbarButton
      [title]="title() || labels.assistantMessageToolbarReadAloudLabel"
      [disabled]="disabled()"
      [inputClass]="inputClass()"
      (click)="handleClick($event)"
    >
      <lucide-angular [img]="Volume2Icon" [size]="20"></lucide-angular>
    </button>
  `,
})
export class CopilotChatAssistantMessageReadAloudButton {
  readonly title = input<string | undefined>();
  readonly disabled = input<boolean>(false);
  readonly inputClass = input<string | undefined>();
  readonly clicked = output<void>();
  readonly Volume2Icon = Volume2;
  readonly labels = injectChatLabels();

  handleClick(event?: Event): void {
    event?.stopPropagation();
    if (!this.disabled()) {
      this.clicked.emit();
    }
  }
}

// Regenerate button component
@Component({
  standalone: true,
  selector: "copilot-chat-assistant-message-regenerate-button",
  imports: [
    CommonModule,
    LucideAngularModule,
    CopilotChatAssistantMessageToolbarButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      copilotChatAssistantMessageToolbarButton
      [title]="title() || labels.assistantMessageToolbarRegenerateLabel"
      [disabled]="disabled()"
      [inputClass]="inputClass()"
      (click)="handleClick($event)"
    >
      <lucide-angular [img]="RefreshCwIcon" [size]="18"></lucide-angular>
    </button>
  `,
})
export class CopilotChatAssistantMessageRegenerateButton {
  readonly title = input<string | undefined>();
  readonly disabled = input<boolean>(false);
  readonly inputClass = input<string | undefined>();
  readonly clicked = output<void>();
  readonly RefreshCwIcon = RefreshCw;
  readonly labels = injectChatLabels();

  handleClick(event?: Event): void {
    event?.stopPropagation();
    if (!this.disabled()) {
      this.clicked.emit();
    }
  }
}
