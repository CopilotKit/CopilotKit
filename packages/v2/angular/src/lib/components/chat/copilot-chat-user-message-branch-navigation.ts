import { Component, input, output, ChangeDetectionStrategy, ViewEncapsulation, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { LucideAngularModule, ChevronLeft, ChevronRight } from "lucide-angular";
import { type CopilotChatUserMessageOnSwitchToBranchProps } from "./copilot-chat-user-message.types";
import { cn } from "../../utils";
import { UserMessage } from "@ag-ui/core";

@Component({
  standalone: true,
  selector: "copilot-chat-user-message-branch-navigation",
  imports: [CommonModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (showNavigation()) {
      <div [class]="computedClass()">
        <button type="button" [class]="buttonClass" [disabled]="!canGoPrev()" (click)="handlePrevious()">
          <lucide-angular [img]="ChevronLeftIcon" [size]="20"></lucide-angular>
        </button>
        <span class="text-sm text-muted-foreground px-0 font-medium">
          {{ currentBranch() + 1 }}/{{ numberOfBranches() }}
        </span>
        <button type="button" [class]="buttonClass" [disabled]="!canGoNext()" (click)="handleNext()">
          <lucide-angular [img]="ChevronRightIcon" [size]="20"></lucide-angular>
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
    "inline-flex items-center justify-center",
    // Cursor
    "cursor-pointer",
    // Background and text
    "p-0 text-[rgb(93,93,93)] hover:bg-[#E8E8E8]",
    // Dark mode
    "dark:text-[rgb(243,243,243)] dark:hover:bg-[#303030]",
    // Shape and sizing
    "h-6 w-6 rounded-md",
    // Interactions
    "transition-colors",
    // Disabled state
    "disabled:opacity-50 disabled:cursor-not-allowed",
  );

  showNavigation = computed(() => this.numberOfBranches() > 1);

  canGoPrev = computed(() => this.currentBranch() > 0);

  canGoNext = computed(() => this.currentBranch() < this.numberOfBranches() - 1);

  computedClass = computed(() => {
    return cn("flex items-center gap-1", this.inputClass());
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
