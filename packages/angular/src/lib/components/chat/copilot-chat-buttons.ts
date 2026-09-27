import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
  computed,
  ViewEncapsulation,
} from "@angular/core";

import {
  ArrowUp,
  CopilotIcon,
  Mic,
  X,
  Check,
  Plus,
} from "../icons/copilot-icon";
import { injectChatLabels } from "../../chat-config";
import { CopilotTooltip } from "../../directives/tooltip";
import { cn } from "../../utils";

// Base button classes matching React's button variants
const buttonBase = cn(
  "cpk:inline-flex cpk:items-center cpk:justify-center cpk:gap-2 cpk:whitespace-nowrap cpk:rounded-md cpk:text-sm cpk:font-medium",
  "cpk:transition-all cpk:disabled:pointer-events-none cpk:disabled:opacity-50",
  "cpk:shrink-0 cpk:outline-none",
  "cpk:focus-visible:border-ring cpk:focus-visible:ring-ring/50 cpk:focus-visible:ring-[3px]",
);

// React's chatInputToolbarPrimary variant with the chatInputToolbarIcon size.
const chatInputToolbarPrimary = cn(
  "cpk:cursor-pointer cpk:rounded-full",
  "cpk:bg-primary cpk:text-primary-foreground cpk:hover:bg-primary/85",
  "cpk:transition-[background-color,transform] cpk:active:scale-95",
  "cpk:disabled:cursor-not-allowed cpk:disabled:bg-foreground/10 cpk:disabled:text-foreground/40 cpk:disabled:opacity-100",
  "cpk:size-9 cpk:[&_svg]:stroke-[2.25]",
);

// React's chatInputToolbarSecondary variant with the chatInputToolbarIcon size.
const chatInputToolbarSecondary = cn(
  "cpk:cursor-pointer cpk:rounded-full",
  "cpk:bg-transparent cpk:text-muted-foreground cpk:hover:bg-accent cpk:hover:text-foreground",
  "cpk:transition-colors",
  "cpk:disabled:cursor-not-allowed cpk:disabled:hover:bg-transparent",
  "cpk:size-9",
);

@Component({
  selector: "copilot-chat-send-button",
  imports: [CopilotIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="cpk:flex">
      <button
        type="button"
        aria-label="Send message"
        data-testid="copilot-send-button"
        [disabled]="disabled()"
        [class]="buttonClass"
        (click)="onClick()"
      >
        <copilot-icon [img]="ArrowUpIcon" [size]="18"></copilot-icon>
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
    if (!this.disabled()) {
      this.clicked.emit();
    }
  }
}

@Component({
  selector: "copilot-chat-start-transcribe-button",
  imports: [CopilotIcon, CopilotTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      type="button"
      [attr.aria-label]="label"
      [disabled]="disabled()"
      [class]="buttonClass"
      [copilotTooltip]="label"
      tooltipPosition="below"
      (click)="onClick()"
    >
      <copilot-icon [img]="MicIcon" [size]="18"></copilot-icon>
    </button>
  `,
  styles: [``],
})
export class CopilotChatStartTranscribeButton {
  disabled = input(false);
  clicked = output<void>();

  readonly labels = injectChatLabels();

  readonly MicIcon = Mic;
  buttonClass = cn(buttonBase, chatInputToolbarSecondary);

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
  selector: "copilot-chat-cancel-transcribe-button",
  imports: [CopilotIcon, CopilotTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      type="button"
      [attr.aria-label]="label"
      [disabled]="disabled()"
      [class]="buttonClass"
      [copilotTooltip]="label"
      tooltipPosition="below"
      (click)="onClick()"
    >
      <copilot-icon [img]="XIcon" [size]="18"></copilot-icon>
    </button>
  `,
  styles: [``],
})
export class CopilotChatCancelTranscribeButton {
  disabled = input(false);
  clicked = output<void>();

  readonly labels = injectChatLabels();

  readonly XIcon = X;
  buttonClass = cn(buttonBase, chatInputToolbarSecondary);

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
  selector: "copilot-chat-finish-transcribe-button",
  imports: [CopilotIcon, CopilotTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      type="button"
      [attr.aria-label]="label"
      [disabled]="disabled()"
      [class]="buttonClass"
      [copilotTooltip]="label"
      tooltipPosition="below"
      (click)="onClick()"
    >
      <copilot-icon [img]="CheckIcon" [size]="18"></copilot-icon>
    </button>
  `,
  styles: [``],
})
export class CopilotChatFinishTranscribeButton {
  disabled = input(false);
  clicked = output<void>();

  readonly labels = injectChatLabels();

  readonly CheckIcon = Check;
  buttonClass = cn(buttonBase, chatInputToolbarSecondary);

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
  selector: "copilot-chat-add-file-button",
  imports: [CopilotIcon, CopilotTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      type="button"
      [attr.aria-label]="label"
      [disabled]="disabled()"
      [class]="buttonClass"
      [copilotTooltip]="label"
      tooltipPosition="below"
      (click)="onClick()"
    >
      <copilot-icon [img]="PlusIcon" [size]="20"></copilot-icon>
    </button>
  `,
  styles: [``],
})
export class CopilotChatAddFileButton {
  disabled = input(false);
  clicked = output<void>();

  readonly labels = injectChatLabels();

  readonly PlusIcon = Plus;
  buttonClass = cn(buttonBase, chatInputToolbarSecondary);

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
  selector: "copilot-chat-toolbar-button",
  imports: [CopilotTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      type="button"
      [disabled]="disabled()"
      [class]="computedClass()"
      [attr.aria-label]="title() || null"
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
  disabled = input(false);
  variant = input<"primary" | "secondary">("secondary");
  customClass = input("");
  title = input("");

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
