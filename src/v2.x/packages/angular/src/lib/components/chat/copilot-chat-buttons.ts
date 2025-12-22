import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
  signal,
  computed,
  ViewEncapsulation,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import {
  LucideAngularModule,
  ArrowUp,
  Mic,
  X,
  Check,
  Plus,
} from "lucide-angular";
import { injectChatLabels } from "../../chat-config";
import { CopilotTooltip } from "../../directives/tooltip";
import { cn } from "../../utils";

// Base button classes matching React's button variants
const buttonBase = cn(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium",
  "transition-all disabled:pointer-events-none disabled:opacity-50",
  "shrink-0 outline-none",
  "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
);

const chatInputToolbarPrimary = cn(
  "cursor-pointer",
  // Background and text
  "bg-black text-white",
  // Dark mode
  "dark:bg-white dark:text-black dark:focus-visible:outline-white",
  // Shape and sizing
  "rounded-full h-9 w-9",
  // Interactions
  "transition-colors",
  // Focus states
  "focus:outline-none",
  // Hover states
  "hover:opacity-70 disabled:hover:opacity-100",
  // Disabled states
  "disabled:cursor-not-allowed disabled:bg-[#00000014] disabled:text-[rgb(13,13,13)]",
  "dark:disabled:bg-[#454545] dark:disabled:text-white"
);

const chatInputToolbarSecondary = cn(
  "cursor-pointer",
  // Background and text
  "bg-transparent text-[#444444]",
  // Dark mode
  "dark:text-white dark:border-[#404040]",
  // Shape and sizing
  "rounded-full h-9 w-9",
  // Interactions
  "transition-colors",
  // Focus states
  "focus:outline-none",
  // Hover states
  "hover:bg-[#f8f8f8] hover:text-[#333333]",
  "dark:hover:bg-[#404040] dark:hover:text-[#FFFFFF]",
  // Disabled states
  "disabled:cursor-not-allowed disabled:opacity-50",
  "disabled:hover:bg-transparent disabled:hover:text-[#444444]",
  "dark:disabled:hover:bg-transparent dark:disabled:hover:text-[#CCCCCC]"
);

@Component({
  standalone: true,
  selector: "copilot-chat-send-button",
  imports: [CommonModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="mr-[10px]">
      <button
        type="button"
        [disabled]="disabled()"
        [class]="buttonClass"
        (click)="onClick()"
      >
        <lucide-angular [img]="ArrowUpIcon" [size]="18"></lucide-angular>
      </button>
    </div>
  `,
  styles: [``],
})
export class CopilotChatSendButton {
  disabled = input(false);
  clicked = output<void>();

  readonly ArrowUpIcon = ArrowUp;
  buttonClass = cn(buttonBase, chatInputToolbarPrimary);

  onClick(): void {
    if (!this.disabled) {
      this.clicked.emit();
    }
  }
}

@Component({
  standalone: true,
  selector: "copilot-chat-start-transcribe-button",
  imports: [CommonModule, LucideAngularModule, CopilotTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      type="button"
      [disabled]="disabled()"
      [class]="buttonClass"
      [copilotTooltip]="label"
      tooltipPosition="below"
      (click)="onClick()"
    >
      <lucide-angular [img]="MicIcon" [size]="18"></lucide-angular>
    </button>
  `,
  styles: [``],
})
export class CopilotChatStartTranscribeButton {
  disabled = input(false);
  clicked = output<void>();

  readonly labels = injectChatLabels();

  readonly MicIcon = Mic;
  buttonClass = cn(buttonBase, chatInputToolbarSecondary, "mr-2");

  get label(): string {
    return this.labels.chatInputToolbarStartTranscribeButtonLabel;
  }

  onClick(): void {
    if (!this.disabled()) {
      this.clicked.emit();
    }
  }
}

@Component({
  standalone: true,
  selector: "copilot-chat-cancel-transcribe-button",
  imports: [CommonModule, LucideAngularModule, CopilotTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      type="button"
      [disabled]="disabled()"
      [class]="buttonClass"
      [copilotTooltip]="label"
      tooltipPosition="below"
      (click)="onClick()"
    >
      <lucide-angular [img]="XIcon" [size]="18"></lucide-angular>
    </button>
  `,
  styles: [``],
})
export class CopilotChatCancelTranscribeButton {
  disabled = input(false);
  clicked = output<void>();

  readonly labels = injectChatLabels();

  readonly XIcon = X;
  buttonClass = cn(buttonBase, chatInputToolbarSecondary, "mr-2");

  get label(): string {
    return this.labels.chatInputToolbarCancelTranscribeButtonLabel;
  }

  onClick(): void {
    if (!this.disabled()) {
      this.clicked.emit();
    }
  }
}

@Component({
  standalone: true,
  selector: "copilot-chat-finish-transcribe-button",
  imports: [CommonModule, LucideAngularModule, CopilotTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      type="button"
      [disabled]="disabled()"
      [class]="buttonClass"
      [copilotTooltip]="label"
      tooltipPosition="below"
      (click)="onClick()"
    >
      <lucide-angular [img]="CheckIcon" [size]="18"></lucide-angular>
    </button>
  `,
  styles: [``],
})
export class CopilotChatFinishTranscribeButton {
  disabled = input(false);
  clicked = output<void>();

  readonly labels = injectChatLabels();

  readonly CheckIcon = Check;
  buttonClass = cn(buttonBase, chatInputToolbarSecondary, "mr-[10px]");

  get label(): string {
    return this.labels.chatInputToolbarFinishTranscribeButtonLabel;
  }

  onClick(): void {
    if (!this.disabled()) {
      this.clicked.emit();
    }
  }
}

@Component({
  standalone: true,
  selector: "copilot-chat-add-file-button",
  imports: [CommonModule, LucideAngularModule, CopilotTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      type="button"
      [disabled]="disabled()"
      [class]="buttonClass"
      [copilotTooltip]="label"
      tooltipPosition="below"
      (click)="onClick()"
    >
      <lucide-angular [img]="PlusIcon" [size]="20"></lucide-angular>
    </button>
  `,
  styles: [``],
})
export class CopilotChatAddFileButton {
  disabled = input(false);
  clicked = output<void>();

  readonly labels = injectChatLabels();

  readonly PlusIcon = Plus;
  buttonClass = cn(buttonBase, chatInputToolbarSecondary, "ml-2");

  get label(): string {
    return this.labels.chatInputToolbarAddButtonLabel;
  }

  onClick(): void {
    if (!this.disabled()) {
      this.clicked.emit();
    }
  }
}

// Base toolbar button component that other buttons can use
@Component({
  standalone: true,
  selector: "copilot-chat-toolbar-button",
  imports: [CommonModule, CopilotTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      type="button"
      [disabled]="disabled()"
      [class]="computedClass()"
      [copilotTooltip]="title()"
      tooltipPosition="below"
      (click)="onClick()"
    >
      <ng-content></ng-content>
    </button>
  `,
  styles: [``],
})
export class CopilotChatToolbarButton {
  disabled = signal(false);
  variant = signal<"primary" | "secondary">("secondary");
  customClass = signal("");
  title = signal("");

  clicked = output<void>();

  computedClass = computed(() => {
    const variantClass =
      this.variant() === "primary"
        ? chatInputToolbarPrimary
        : chatInputToolbarSecondary;
    return cn(buttonBase, variantClass, this.customClass());
  });

  onClick(): void {
    if (!this.disabled()) {
      this.clicked.emit();
    }
  }
}
