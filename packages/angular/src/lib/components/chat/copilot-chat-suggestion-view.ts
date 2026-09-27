import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  output,
} from "@angular/core";
import type { Suggestion } from "@copilotkit/core";
import { cn } from "../../utils";
import { CopilotChatSuggestionPill } from "./copilot-chat-suggestion-pill";

// Pills: a single scrollable row whose right edge fades when pills overflow.
const suggestionRowClass = cn(
  "cpk:flex cpk:flex-nowrap cpk:items-center cpk:gap-2 cpk:overflow-x-auto cpk:py-1 cpk:pointer-events-auto",
  "cpk:[scrollbar-width:none] cpk:[&::-webkit-scrollbar]:hidden",
  "cpk:[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]",
);
// Cards: two columns at every width, so cards stay close to square in narrow
// chats (popup, sidebar) too. `auto-rows-fr` gives every card the same height.
const suggestionGridClass = cn(
  "cpk:grid cpk:w-full cpk:auto-rows-fr cpk:grid-cols-2 cpk:gap-2 cpk:pointer-events-auto",
);

@Component({
  selector: "copilot-chat-suggestion-view",
  imports: [CopilotChatSuggestionPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { "data-copilotkit": "", "[attr.data-appearance]": "appearance()" },
  template: `
    @if (suggestions().length > 0) {
      <div
        data-copilotkit
        data-testid="copilot-suggestions"
        [attr.data-appearance]="appearance()"
        [class]="computedClass()"
      >
        @for (suggestion of suggestions(); track suggestion.message + $index) {
          <copilot-chat-suggestion-pill
            [title]="suggestion.title"
            [inputClass]="suggestion.className"
            [isLoading]="suggestion.isLoading === true"
            [appearance]="appearance() === 'cards' ? 'card' : 'pill'"
            [description]="cardDescription(suggestion)"
            (clicked)="handleSelect(suggestion, $index)"
          />
        }
      </div>
    }
  `,
})
export class CopilotChatSuggestionView {
  readonly suggestions = input<Suggestion[]>([]);
  readonly inputClass = input<string | undefined>();
  /**
   * `"pills"` (default): compact chips in a single scrollable row.
   * `"cards"`: a grid of cards, each with the suggestion's title as header and
   * its message as body. Welcome screens use cards.
   */
  readonly appearance = input<"pills" | "cards">("pills");

  readonly selectSuggestion = output<{
    suggestion: Suggestion;
    index: number;
  }>();

  protected readonly computedClass = computed(() =>
    cn(
      this.appearance() === "cards" ? suggestionGridClass : suggestionRowClass,
      this.inputClass(),
    ),
  );

  /** A card's body: the message, unless it just repeats the title. */
  protected cardDescription(suggestion: Suggestion): string | undefined {
    return this.appearance() === "cards" &&
      suggestion.message &&
      suggestion.message !== suggestion.title
      ? suggestion.message
      : undefined;
  }

  handleSelect(suggestion: Suggestion, index: number): void {
    if (suggestion.isLoading) {
      return;
    }

    this.selectSuggestion.emit({ suggestion, index });
  }
}
