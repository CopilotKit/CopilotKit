import {
  Component,
  input,
  output,
  signal,
  computed,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";

import {
  CopilotIcon,
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  Volume2,
  RefreshCw,
} from "../icons/copilot-icon";
import { CopilotTooltip } from "../../directives/tooltip";
import { cn } from "../../utils";
import { MESSAGE_TOOLBAR_BUTTON_CLASS } from "./message-toolbar-button";
import { injectChatLabels } from "../../chat-config";
import { copyToClipboard } from "@copilotkit/shared";

// Base toolbar button component
@Component({
  selector: "button[copilotChatAssistantMessageToolbarButton]",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <ng-content></ng-content>
  `,
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

  computedClass = computed(() =>
    cn(MESSAGE_TOOLBAR_BUTTON_CLASS, this.inputClass()),
  );
}

// Copy button component
@Component({
  selector: "copilot-chat-assistant-message-copy-button",
  imports: [CopilotIcon, CopilotChatAssistantMessageToolbarButton],
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
        <copilot-icon [img]="CheckIcon" [size]="16"></copilot-icon>
      } @else {
        <copilot-icon [img]="CopyIcon" [size]="16"></copilot-icon>
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

    copyToClipboard(this.content()!).then((success) => {
      if (success) {
        this.copied.set(true);
        this.clicked.emit();
        setTimeout(() => this.copied.set(false), 2000);
      }
    });
  }
}

// Thumbs up button component
@Component({
  selector: "copilot-chat-assistant-message-thumbs-up-button",
  imports: [CopilotIcon, CopilotChatAssistantMessageToolbarButton],
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
      <copilot-icon [img]="ThumbsUpIcon" [size]="16"></copilot-icon>
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
  selector: "copilot-chat-assistant-message-thumbs-down-button",
  imports: [CopilotIcon, CopilotChatAssistantMessageToolbarButton],
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
      <copilot-icon [img]="ThumbsDownIcon" [size]="16"></copilot-icon>
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
  selector: "copilot-chat-assistant-message-read-aloud-button",
  imports: [CopilotIcon, CopilotChatAssistantMessageToolbarButton],
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
      <copilot-icon [img]="Volume2Icon" [size]="16"></copilot-icon>
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
  selector: "copilot-chat-assistant-message-regenerate-button",
  imports: [CopilotIcon, CopilotChatAssistantMessageToolbarButton],
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
      <copilot-icon [img]="RefreshCwIcon" [size]="16"></copilot-icon>
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
