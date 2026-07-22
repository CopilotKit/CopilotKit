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
          [class]="buttonClass"
          [disabled]="!canGoPrev()"
          (click)="handlePrevious()"
        >
          <copilot-icon [img]="ChevronLeftIcon" [size]="20"></copilot-icon>
        </button>
        <span
          class="cpk:text-sm cpk:text-muted-foreground cpk:px-0 cpk:font-medium"
        >
          {{ currentBranch() + 1 }}/{{ numberOfBranches() }}
        </span>
        <button
          type="button"
          [class]="buttonClass"
          [disabled]="!canGoNext()"
          (click)="handleNext()"
        >
          <copilot-icon [img]="ChevronRightIcon" [size]="20"></copilot-icon>
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

  readonly buttonClass = cn(
    // Flex centering
    "cpk:inline-flex cpk:items-center cpk:justify-center",
    // Cursor
    "cpk:cursor-pointer",
    // Background and text
    "cpk:p-0 cpk:text-[rgb(93,93,93)] cpk:hover:bg-[#E8E8E8]",
    // Dark mode
    "cpk:dark:text-[rgb(243,243,243)] cpk:dark:hover:bg-[#303030]",
    // Shape and sizing
    "cpk:h-6 cpk:w-6 cpk:rounded-md",
    // Interactions
    "cpk:transition-colors",
    // Disabled state
    "cpk:disabled:opacity-50 cpk:disabled:cursor-not-allowed",
  );

  showNavigation = computed(() => this.numberOfBranches() > 1);

  canGoPrev = computed(() => this.currentBranch() > 0);

  canGoNext = computed(
    () => this.currentBranch() < this.numberOfBranches() - 1,
  );

  computedClass = computed(() => {
    return cn("cpk:flex cpk:items-center cpk:gap-1", this.inputClass());
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
