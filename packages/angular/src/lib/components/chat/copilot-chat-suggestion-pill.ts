import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  computed,
  input,
  output,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { LucideAngularModule, LoaderCircle } from "lucide-angular";
import { cn } from "../../utils";

const baseClasses =
  "group inline-flex h-7 sm:h-8 items-center gap-1 sm:gap-1.5 rounded-full border border-border/60 bg-background px-2.5 sm:px-3 text-[11px] sm:text-xs leading-none text-foreground transition-colors cursor-pointer hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-background disabled:hover:text-muted-foreground pointer-events-auto";

const labelClasses = "whitespace-nowrap font-medium leading-none";
const iconWrapperClasses =
  "flex h-3.5 sm:h-4 w-3.5 sm:w-4 items-center justify-center text-muted-foreground";

@Component({
  standalone: true,
  selector: "copilot-chat-suggestion-pill",
  imports: [CommonModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      data-copilotkit
      data-testid="copilot-suggestion"
      data-slot="suggestion-pill"
      [class]="computedClass()"
      [type]="resolvedType()"
      [attr.aria-busy]="isLoading() ? true : null"
      [disabled]="isDisabled()"
      (click)="handleClick($event)"
    >
      @if (isLoading()) {
        <span [class]="iconWrapperClass">
          <lucide-angular
            [img]="LoaderIcon"
            class="h-3.5 sm:h-4 w-3.5 sm:w-4 animate-spin"
            aria-hidden="true"
          ></lucide-angular>
        </span>
      } @else if (showIcon()) {
        <span [class]="iconWrapperClass">{{ icon() }}</span>
      }
      <span [class]="labelClass">{{ children() }}</span>
    </button>
  `,
})
export class CopilotChatSuggestionPill {
  readonly children = input<string>("");
  readonly icon = input<string | undefined>(undefined);
  readonly isLoading = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly type = input<"button" | "submit" | "reset" | undefined>(undefined);
  readonly inputClass = input<string | undefined>(undefined);
  readonly clickHandler = input<((event?: Event) => void) | undefined>(
    undefined,
  );

  readonly clicked = output<Event>();

  protected readonly LoaderIcon = LoaderCircle;
  protected readonly labelClass = labelClasses;
  protected readonly iconWrapperClass = iconWrapperClasses;

  readonly resolvedType = computed<"button" | "submit" | "reset">(
    () => this.type() ?? "button",
  );

  readonly isDisabled = computed(() => this.isLoading() || this.disabled());

  readonly showIcon = computed(() => !this.isLoading() && !!this.icon());

  readonly computedClass = computed(() =>
    cn(baseClasses, this.inputClass()),
  );

  handleClick(event: Event): void {
    if (this.isDisabled()) return;
    const fn = this.clickHandler();
    if (fn) fn(event);
    this.clicked.emit(event);
  }
}
