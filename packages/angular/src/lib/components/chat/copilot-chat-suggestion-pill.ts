import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  output,
} from "@angular/core";
import { cn } from "../../utils";
import { CopilotIcon, LoaderCircle } from "../icons/copilot-icon";

const suggestionPillClass = cn(
  "cpk:group cpk:inline-flex cpk:h-8 cpk:items-center cpk:gap-1.5 cpk:rounded-full",
  "cpk:border cpk:border-input cpk:bg-card cpk:px-3.5",
  "cpk:text-[13px] cpk:leading-none cpk:text-foreground/80 cpk:shadow-[0_1px_2px_0_rgb(0_0_0/0.03)] cpk:transition-colors",
  "cpk:cursor-pointer cpk:hover:bg-accent cpk:hover:text-foreground",
  "cpk:focus-visible:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-ring",
  "cpk:focus-visible:ring-offset-2 cpk:focus-visible:ring-offset-background",
  "cpk:disabled:cursor-not-allowed cpk:disabled:text-muted-foreground",
  "cpk:disabled:hover:bg-card cpk:disabled:hover:text-muted-foreground",
  "cpk:pointer-events-auto",
);

// A larger tile with the title as header and a description as body; used on
// welcome screens.
const suggestionCardClass = cn(
  "cpk:group cpk:flex cpk:h-full cpk:w-full cpk:min-w-0 cpk:flex-col cpk:items-start cpk:gap-1",
  "cpk:rounded-2xl cpk:border cpk:border-input cpk:bg-card cpk:px-3.5 cpk:py-3 cpk:text-left",
  "cpk:shadow-[0_1px_2px_0_rgb(0_0_0/0.03)] cpk:transition-colors cpk:cursor-pointer cpk:hover:bg-accent",
  "cpk:focus-visible:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-ring",
  "cpk:focus-visible:ring-offset-2 cpk:focus-visible:ring-offset-background",
  "cpk:disabled:cursor-not-allowed cpk:disabled:opacity-60 cpk:disabled:hover:bg-card",
  "cpk:pointer-events-auto",
);

@Component({
  selector: "copilot-chat-suggestion-pill",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [CopilotIcon],
  host: { "data-copilotkit": "", "[attr.data-appearance]": "appearance()" },
  template: `
    @if (appearance() === "card") {
      <button
        data-copilotkit
        data-testid="copilot-suggestion"
        data-slot="suggestion-card"
        type="button"
        [class]="computedCardClass()"
        [disabled]="disabled() || isLoading()"
        [attr.aria-busy]="isLoading() ? 'true' : null"
        (click)="handleClick()"
      >
        <span
          class="cpk:flex cpk:w-full cpk:min-w-0 cpk:items-center cpk:gap-1.5 cpk:text-sm cpk:font-medium cpk:leading-snug cpk:text-foreground"
        >
          @if (isLoading()) {
            <copilot-icon
              class="cpk:shrink-0 cpk:animate-spin cpk:text-muted-foreground"
              [img]="LoaderCircle"
              [size]="14"
            />
          }
          <span class="cpk:truncate">{{ title() }}</span>
        </span>
        @if (description()) {
          <span
            class="cpk:line-clamp-2 cpk:text-[13px] cpk:leading-snug cpk:text-muted-foreground"
            >{{ description() }}</span
          >
        }
      </button>
    } @else {
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
    }
  `,
})
export class CopilotChatSuggestionPill {
  readonly title = input<string>("");
  readonly disabled = input(false);
  readonly isLoading = input(false);
  readonly inputClass = input<string | undefined>();
  /**
   * `"pill"` (default) is a compact chip. `"card"` is a larger tile with the
   * title as a header and `description` as its body, used on welcome screens.
   */
  readonly appearance = input<"pill" | "card">("pill");
  /** Body text shown under the title when `appearance` is `"card"`. */
  readonly description = input<string | undefined>();

  readonly clicked = output<void>();

  protected readonly LoaderCircle = LoaderCircle;
  protected readonly computedClass = computed(() =>
    cn(suggestionPillClass, this.inputClass()),
  );
  protected readonly computedCardClass = computed(() =>
    cn(suggestionCardClass, this.inputClass()),
  );

  handleClick(): void {
    if (this.disabled() || this.isLoading()) {
      return;
    }

    this.clicked.emit();
  }
}
