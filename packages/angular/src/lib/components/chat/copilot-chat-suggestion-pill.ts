import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  output,
} from "@angular/core";
import { cn } from "../../utils";

const suggestionPillClass = cn(
  "cpk:group cpk:inline-flex cpk:h-7 cpk:sm:h-8 cpk:items-center cpk:gap-1 cpk:sm:gap-1.5 cpk:rounded-full",
  "cpk:border cpk:border-border/60 cpk:bg-background cpk:px-2.5 cpk:sm:px-3",
  "cpk:text-[11px] cpk:sm:text-xs cpk:leading-none cpk:text-foreground cpk:transition-colors",
  "cpk:cursor-pointer cpk:hover:bg-accent/60 cpk:hover:text-foreground",
  "cpk:focus-visible:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-ring",
  "cpk:focus-visible:ring-offset-2 cpk:focus-visible:ring-offset-background",
  "cpk:disabled:cursor-not-allowed cpk:disabled:text-muted-foreground",
  "cpk:disabled:hover:bg-background cpk:disabled:hover:text-muted-foreground",
  "cpk:pointer-events-auto",
);

@Component({
  selector: "copilot-chat-suggestion-pill",
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
        <span
          class="cpk:inline-block cpk:size-3 cpk:animate-spin cpk:rounded-full cpk:border cpk:border-current cpk:border-t-transparent cpk:opacity-70"
          aria-hidden="true"
        ></span>
      }
      <span class="cpk:whitespace-nowrap cpk:font-medium cpk:leading-none">
        {{ title() }}
      </span>
    </button>
  `,
})
export class CopilotChatSuggestionPill {
  readonly title = input<string>("");
  readonly disabled = input(false);
  readonly isLoading = input(false);
  readonly inputClass = input<string | undefined>();

  readonly clicked = output<void>();

  protected readonly computedClass = computed(() =>
    cn(suggestionPillClass, this.inputClass()),
  );

  handleClick(): void {
    if (this.disabled() || this.isLoading()) {
      return;
    }

    this.clicked.emit();
  }
}
