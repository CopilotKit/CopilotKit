import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  output,
} from "@angular/core";
import { cn } from "../../utils";
import { CopilotIcon, Loader2 } from "../icons/copilot-icon";

@Component({
  selector: "copilot-chat-suggestion-pill",
  imports: [CopilotIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { "data-copilotkit": "" },
  template: `
    <button
      data-copilotkit
      data-testid="copilot-suggestion"
      data-slot="suggestion-pill"
      type="button"
      [class]="computedClass()"
      [disabled]="disabled() || isLoading()"
      [attr.aria-busy]="isLoading() ? 'true' : null"
      (click)="handleClick()"
    >
      @if (isLoading()) {
        <span class="cpk-suggestion-pill-icon">
          <copilot-icon
            [img]="Loader2Icon"
            iconClass="cpk-suggestion-pill-spinner"
          ></copilot-icon>
        </span>
      }
      <span class="cpk-suggestion-pill-label">{{ title() }}</span>
    </button>
  `,
})
export class CopilotChatSuggestionPill {
  readonly title = input<string>("");
  readonly disabled = input(false);
  readonly isLoading = input(false);
  readonly inputClass = input<string | undefined>();

  readonly clicked = output<void>();
  protected readonly Loader2Icon = Loader2;

  protected readonly computedClass = computed(() =>
    cn("cpk-suggestion-pill", this.inputClass()),
  );

  handleClick(): void {
    if (this.disabled() || this.isLoading()) {
      return;
    }

    this.clicked.emit();
  }
}
