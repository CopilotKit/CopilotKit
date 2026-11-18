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
import { injectChatLabels } from "../../chat-config";
import { ɵgetBranchNavState } from "@copilotkit/core";
import { UserMessage } from "@ag-ui/core";

@Component({
  selector: "copilot-chat-user-message-branch-navigation",
  imports: [CopilotIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (showNavigation()) {
      <div data-testid="copilot-branch-navigation" [class]="computedClass()">
        <button
          type="button"
          [attr.aria-label]="labels.userMessageToolbarPreviousBranchLabel"
          [class]="buttonClass"
          [disabled]="!canGoPrev()"
          (click)="handlePrevious()"
        >
          <copilot-icon
            [img]="ChevronLeftIcon"
            iconClass="cpk-user-message-branch-icon"
          ></copilot-icon>
        </button>
        <span class="cpk-user-message-branch-counter">
          {{ currentBranch() + 1 }}/{{ numberOfBranches() }}
        </span>
        <button
          type="button"
          [attr.aria-label]="labels.userMessageToolbarNextBranchLabel"
          [class]="buttonClass"
          [disabled]="!canGoNext()"
          (click)="handleNext()"
        >
          <copilot-icon
            [img]="ChevronRightIcon"
            iconClass="cpk-user-message-branch-icon"
          ></copilot-icon>
        </button>
      </div>
    }
  `,
})
export class CopilotChatUserMessageBranchNavigation {
  currentBranch = input<number>(0);
  numberOfBranches = input<number>(1);
  /**
   * Whether something handles `switchToBranch`, so the branch arrows can work.
   * With `false` the branch navigation stays hidden, as React and Vue hide it
   * without an `onSwitchToBranch` handler. An Angular `output()` cannot tell
   * whether a listener is bound, so this defaults to `true`: navigation shows
   * whenever there is more than one branch.
   */
  branchSwitchEnabled = input<boolean>(true);
  message = input<UserMessage>();
  inputClass = input<string | undefined>();
  switchToBranch = output<CopilotChatUserMessageOnSwitchToBranchProps>();

  readonly ChevronLeftIcon = ChevronLeft;
  readonly ChevronRightIcon = ChevronRight;
  readonly labels = injectChatLabels();

  readonly buttonClass =
    "cpk-button cpk-button-assistant-message-toolbar cpk-button-size-default cpk-user-message-branch-button";

  readonly #navState = computed(() =>
    ɵgetBranchNavState({
      branchIndex: this.currentBranch(),
      numberOfBranches: this.numberOfBranches(),
      canSwitch: this.branchSwitchEnabled(),
    }),
  );

  showNavigation = computed(() => this.#navState().show);

  canGoPrev = computed(() => this.#navState().canGoPrev);

  canGoNext = computed(() => this.#navState().canGoNext);

  computedClass = computed(() => {
    return cn("cpk-user-message-branch-navigation", this.inputClass());
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
