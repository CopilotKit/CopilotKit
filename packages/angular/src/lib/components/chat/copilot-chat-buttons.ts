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

// Same classes as React's <Button> variants (core's ui/button.css).
const chatInputToolbarPrimary =
  "cpk-button cpk-button-chat-input-toolbar-primary cpk-button-size-chat-input-toolbar-icon";
const chatInputToolbarSecondary =
  "cpk-button cpk-button-chat-input-toolbar-secondary cpk-button-size-chat-input-toolbar-icon";

@Component({
  selector: "copilot-chat-send-button",
  imports: [CopilotIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="cpk-chat-input-send">
      <button
        type="button"
        [attr.aria-label]="labels.chatInputToolbarSendButtonLabel"
        [disabled]="disabled()"
        [class]="buttonClass"
        (click)="onClick()"
      >
        <copilot-icon
          [img]="ArrowUpIcon"
          iconClass="cpk-chat-input-send-icon"
        ></copilot-icon>
      </button>
    </div>
  `,
})
export class CopilotChatSendButton {
  disabled = input(false);
  clicked = output<void>();
  readonly labels = injectChatLabels();

  readonly ArrowUpIcon = ArrowUp;
  buttonClass = chatInputToolbarPrimary;

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
      <copilot-icon
        [img]="MicIcon"
        iconClass="cpk-chat-input-toolbar-icon"
      ></copilot-icon>
    </button>
  `,
})
export class CopilotChatStartTranscribeButton {
  disabled = input(false);
  clicked = output<void>();

  readonly labels = injectChatLabels();

  readonly MicIcon = Mic;
  buttonClass = `${chatInputToolbarSecondary} cpk-chat-input-start-transcribe-button`;

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
      <copilot-icon
        [img]="XIcon"
        iconClass="cpk-chat-input-toolbar-icon"
      ></copilot-icon>
    </button>
  `,
})
export class CopilotChatCancelTranscribeButton {
  disabled = input(false);
  clicked = output<void>();

  readonly labels = injectChatLabels();

  readonly XIcon = X;
  buttonClass = `${chatInputToolbarSecondary} cpk-chat-input-cancel-transcribe-button`;

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
      <copilot-icon
        [img]="CheckIcon"
        iconClass="cpk-chat-input-toolbar-icon"
      ></copilot-icon>
    </button>
  `,
})
export class CopilotChatFinishTranscribeButton {
  disabled = input(false);
  clicked = output<void>();

  readonly labels = injectChatLabels();

  readonly CheckIcon = Check;
  buttonClass = `${chatInputToolbarSecondary} cpk-chat-input-finish-transcribe-button`;

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
      <copilot-icon
        [img]="PlusIcon"
        iconClass="cpk-chat-input-add-menu-icon"
      ></copilot-icon>
    </button>
  `,
})
export class CopilotChatAddFileButton {
  disabled = input(false);
  clicked = output<void>();

  readonly labels = injectChatLabels();

  readonly PlusIcon = Plus;
  buttonClass = `${chatInputToolbarSecondary} cpk-chat-input-add-menu-button`;

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
    return cn(variantClass, this.customClass());
  });

  onClick(): void {
    if (!this.disabled()) {
      this.clicked.emit();
    }
  }
}
