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

const suggestionViewClass = cn(
  "cpk:flex cpk:flex-wrap cpk:items-center cpk:gap-1.5 cpk:sm:gap-2 cpk:pl-0 cpk:pr-4 cpk:@3xl:px-0",
  "cpk:pointer-events-none",
);

@Component({
  selector: "copilot-chat-suggestion-view",
  imports: [CopilotChatSuggestionPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { "data-copilotkit": "" },
  template: `
    @if (suggestions().length > 0) {
      <div
        data-copilotkit
        data-testid="copilot-suggestions"
        [class]="computedClass()"
      >
        @for (suggestion of suggestions(); track suggestion.message + $index) {
          <copilot-chat-suggestion-pill
            [title]="suggestion.title"
            [inputClass]="suggestion.className"
            [isLoading]="suggestion.isLoading === true"
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

  readonly selectSuggestion = output<{
    suggestion: Suggestion;
    index: number;
  }>();

  protected readonly computedClass = computed(() =>
    cn(suggestionViewClass, this.inputClass()),
  );

  handleSelect(suggestion: Suggestion, index: number): void {
    if (suggestion.isLoading) {
      return;
    }

    this.selectSuggestion.emit({ suggestion, index });
  }
}
