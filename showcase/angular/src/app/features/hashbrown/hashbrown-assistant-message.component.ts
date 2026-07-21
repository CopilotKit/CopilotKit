import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";
import { injectJsonParser, RenderMessageComponent } from "@hashbrownai/angular";
import type { UiChatSchema } from "@hashbrownai/angular";

import { salesDashboardUiKit } from "./hashbrown-kit";

interface AssistantMessageLike {
  role: string;
  content?: string | null;
}

@Component({
  selector: "showcase-hashbrown-assistant-message",
  imports: [RenderMessageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    "data-testid": "copilot-assistant-message",
    "data-message-role": "assistant",
    class: "hashbrown-assistant-message",
  },
  template: `
    @if (parsedUi(); as ui) {
      <hb-render-message [ui]="ui" [uiKit]="uiKit" />
    } @else if (hasRenderError()) {
      <p class="hashbrown-render-error" role="alert">
        This generated interface could not be rendered.
      </p>
    } @else {
      <p class="hashbrown-render-status" role="status">
        Building generated interface…
      </p>
    }
  `,
})
export class HashbrownAssistantMessage {
  readonly message = input.required<AssistantMessageLike>();
  protected readonly uiKit = salesDashboardUiKit;
  private readonly content = computed(() => this.message().content ?? "");
  protected readonly parser = injectJsonParser(
    this.content,
    salesDashboardUiKit.schema,
  );
  protected readonly parsedUi = computed(() => {
    const value = this.parser.value() as UiChatSchema | undefined;
    return value && Array.isArray(value.ui) && value.ui.length > 0
      ? value
      : undefined;
  });
  protected readonly hasRenderError = computed(
    () =>
      this.parser.error() !== undefined ||
      (this.content().trim().length > 0 &&
        (this.parser.parserState().isComplete ||
          this.parser.parserState().mode === "Done") &&
        this.parsedUi() === undefined),
  );
}
