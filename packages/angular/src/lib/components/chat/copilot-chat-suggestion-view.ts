import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  ContentChild,
  TemplateRef,
  Type,
  computed,
  input,
  output,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { CopilotSlot } from "../../slots/copilot-slot";
import { CopilotChatSuggestionPill } from "./copilot-chat-suggestion-pill";
import { cn } from "../../utils";
import {
  type Suggestion,
  type SuggestionPillContext,
  type SuggestionContainerContext,
} from "./copilot-chat-suggestion-view.types";

const containerBaseClasses =
  "flex flex-wrap items-center gap-1.5 sm:gap-2 pl-0 pr-4 sm:px-0 pointer-events-none";

@Component({
  standalone: true,
  selector: "copilot-chat-suggestion-view-container",
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div
      data-copilotkit
      data-testid="copilot-suggestions"
      [class]="computedClass()"
    >
      <ng-content></ng-content>
    </div>
  `,
})
export class CopilotChatSuggestionViewContainer {
  readonly inputClass = input<string | undefined>(undefined);

  readonly computedClass = computed(() =>
    cn(containerBaseClasses, this.inputClass()),
  );
}

interface SuggestionPillEntry {
  key: string;
  context: SuggestionPillContext;
}

@Component({
  standalone: true,
  selector: "copilot-chat-suggestion-view",
  host: { "data-copilotkit": "" },
  imports: [
    CommonModule,
    CopilotSlot,
    CopilotChatSuggestionPill,
    CopilotChatSuggestionViewContainer,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (containerTemplate || containerComponent()) {
      <copilot-slot
        [slot]="containerTemplate || containerComponent()"
        [context]="containerContext()"
        [defaultComponent]="DefaultContainerComponent"
      >
        <ng-container *ngTemplateOutlet="pillsTemplate"></ng-container>
      </copilot-slot>
    } @else {
      <copilot-chat-suggestion-view-container [inputClass]="inputClass()">
        <ng-container *ngTemplateOutlet="pillsTemplate"></ng-container>
      </copilot-chat-suggestion-view-container>
    }

    <ng-template #pillsTemplate>
      @for (pill of pillEntries(); track pill.key) {
        @if (pillTemplate || pillComponent()) {
          <copilot-slot
            [slot]="pillTemplate || pillComponent()"
            [context]="pill.context"
            [defaultComponent]="DefaultPillComponent"
          ></copilot-slot>
        } @else {
          <copilot-chat-suggestion-pill
            [children]="pill.context.children"
            [isLoading]="pill.context.isLoading"
            [type]="pill.context.type"
            [inputClass]="pill.context.inputClass"
            [clickHandler]="pill.context.clickHandler"
          ></copilot-chat-suggestion-pill>
        }
      }
    </ng-template>
  `,
})
export class CopilotChatSuggestionView {
  @ContentChild("container", { read: TemplateRef })
  containerTemplate?: TemplateRef<SuggestionContainerContext>;
  @ContentChild("pill", { read: TemplateRef })
  pillTemplate?: TemplateRef<SuggestionPillContext>;

  readonly suggestions = input<Suggestion[]>([]);
  readonly loadingIndexes = input<ReadonlyArray<number> | undefined>(undefined);
  readonly inputClass = input<string | undefined>(undefined);

  readonly containerComponent = input<Type<unknown> | undefined>(undefined);
  readonly pillComponent = input<Type<unknown> | undefined>(undefined);

  readonly selectSuggestion = output<{
    suggestion: Suggestion;
    index: number;
  }>();

  protected readonly DefaultContainerComponent =
    CopilotChatSuggestionViewContainer;
  protected readonly DefaultPillComponent = CopilotChatSuggestionPill;

  readonly loadingSet = computed<Set<number>>(() => {
    const indexes = this.loadingIndexes();
    if (!indexes || indexes.length === 0) {
      return new Set<number>();
    }
    return new Set(indexes);
  });

  readonly containerContext = computed<SuggestionContainerContext>(() => ({
    inputClass: this.inputClass(),
  }));

  readonly pillEntries = computed<SuggestionPillEntry[]>(() => {
    const list = this.suggestions();
    const loadingSet = this.loadingSet();
    return list.map((suggestion, index) => {
      const isLoading = loadingSet.has(index) || suggestion.isLoading === true;
      const context: SuggestionPillContext = {
        children: suggestion.title,
        isLoading,
        type: "button",
        inputClass: suggestion.className,
        clickHandler: () => this.handleSelect(suggestion, index),
      };
      return {
        key: `${suggestion.title}-${index}`,
        context,
      };
    });
  });

  handleSelect(suggestion: Suggestion, index: number): void {
    this.selectSuggestion.emit({ suggestion, index });
  }
}
