import {
  Component,
  input,
  output,
  signal,
  computed,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";

import { Check, CopilotIcon, Copy, Edit } from "../icons/copilot-icon";
import { CopilotTooltip } from "../../directives/tooltip";
import { cn } from "../../utils";
import { MESSAGE_TOOLBAR_BUTTON_CLASS } from "./message-toolbar-button";
import { injectChatLabels } from "../../chat-config";
import { copyToClipboard } from "@copilotkit/shared";

// Base toolbar button component
@Component({
  selector: "button[copilotChatUserMessageToolbarButton]",
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
export class CopilotChatUserMessageToolbarButton {
  title = input<string>("");
  disabled = input<boolean>(false);
  inputClass = input<string | undefined>();

  computedClass = computed(() =>
    cn(MESSAGE_TOOLBAR_BUTTON_CLASS, this.inputClass()),
  );
}

// Copy button component
@Component({
  selector: "copilot-chat-user-message-copy-button",
  imports: [CopilotIcon, CopilotChatUserMessageToolbarButton],
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
        <copilot-icon [img]="CheckIcon" [size]="16"></copilot-icon>
      } @else {
        <copilot-icon [img]="CopyIcon" [size]="16"></copilot-icon>
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

    copyToClipboard(this.content()!).then((success) => {
      if (success) {
        this.copied.set(true);
        this.clicked.emit();
        setTimeout(() => this.copied.set(false), 2000);
      }
    });
  }
}

// Edit button component
@Component({
  selector: "copilot-chat-user-message-edit-button",
  imports: [CopilotIcon, CopilotChatUserMessageToolbarButton],
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
      <copilot-icon [img]="EditIcon" [size]="16"></copilot-icon>
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
