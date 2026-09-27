import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  computed,
} from "@angular/core";

import { ChevronLeft, ChevronRight, CopilotIcon } from "../icons/copilot-icon";
import { type CopilotChatUserMessageOnSwitchToBranchProps } from "./copilot-chat-user-message.types";
import { cn } from "../../utils";
import { MESSAGE_TOOLBAR_BUTTON_CLASS } from "./message-toolbar-button";
import { UserMessage } from "@ag-ui/core";

@Component({
  selector: "copilot-chat-user-message-branch-navigation",
  imports: [CopilotIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (showNavigation()) {
      <div [class]="computedClass()">
        <button
          type="button"
          aria-label="Previous message branch"
          [class]="buttonClass"
          [disabled]="!canGoPrev()"
          (click)="handlePrevious()"
        >
          <copilot-icon [img]="ChevronLeftIcon" [size]="16"></copilot-icon>
        </button>
        <span
          class="cpk:min-w-7 cpk:text-center cpk:text-xs cpk:tabular-nums cpk:text-muted-foreground cpk:font-medium"
        >
          {{ currentBranch() + 1 }}/{{ numberOfBranches() }}
        </span>
        <button
          type="button"
          aria-label="Next message branch"
          [class]="buttonClass"
          [disabled]="!canGoNext()"
          (click)="handleNext()"
        >
          <copilot-icon [img]="ChevronRightIcon" [size]="16"></copilot-icon>
        </button>
      </div>
    }
  `,
})
export class CopilotChatUserMessageBranchNavigation {
  currentBranch = input<number>(0);
  numberOfBranches = input<number>(1);
  message = input<UserMessage>();
  inputClass = input<string | undefined>();
  switchToBranch = output<CopilotChatUserMessageOnSwitchToBranchProps>();

  readonly ChevronLeftIcon = ChevronLeft;
  readonly ChevronRightIcon = ChevronRight;

  readonly buttonClass = cn(MESSAGE_TOOLBAR_BUTTON_CLASS, "cpk:size-6");

  showNavigation = computed(() => this.numberOfBranches() > 1);

  canGoPrev = computed(() => this.currentBranch() > 0);

  canGoNext = computed(
    () => this.currentBranch() < this.numberOfBranches() - 1,
  );

  computedClass = computed(() => {
    return cn("cpk:flex cpk:items-center cpk:gap-0.5", this.inputClass());
  });

  handlePrevious(): void {
    if (this.canGoPrev()) {
      const newIndex = this.currentBranch() - 1;
      this.switchToBranch.emit({
        branchIndex: newIndex,
        numberOfBranches: this.numberOfBranches(),
        message: this.message()!,
      });
    }
  }

  handleNext(): void {
    if (this.canGoNext()) {
      const newIndex = this.currentBranch() + 1;
      this.switchToBranch.emit({
        branchIndex: newIndex,
        numberOfBranches: this.numberOfBranches(),
        message: this.message()!,
      });
    }
  }
}
