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

  computedClass = computed(() => {
    return cn(
      // Flex centering
      "cpk:inline-flex cpk:items-center cpk:justify-center",
      // Cursor
      "cpk:cursor-pointer",
      // Background and text
      "cpk:p-0 cpk:text-[rgb(93,93,93)] cpk:hover:bg-[#E8E8E8]",
      // Dark mode
      "cpk:dark:text-[rgb(243,243,243)] cpk:dark:hover:bg-[#303030]",
      // Shape and sizing
      "cpk:h-8 cpk:w-8 cpk:rounded-md",
      // Interactions
      "cpk:transition-colors",
      // Hover states
      "cpk:hover:text-[rgb(93,93,93)]",
      "cpk:dark:hover:text-[rgb(243,243,243)]",
      // Focus states
      "cpk:focus:outline-none cpk:focus:ring-2 cpk:focus:ring-offset-2",
      // Disabled state
      "cpk:disabled:opacity-50 cpk:disabled:cursor-not-allowed",
      this.inputClass(),
    );
  });
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
        <copilot-icon [img]="CheckIcon" [size]="18"></copilot-icon>
      } @else {
        <copilot-icon [img]="CopyIcon" [size]="18"></copilot-icon>
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
      <copilot-icon [img]="EditIcon" [size]="18"></copilot-icon>
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
