import { Component, computed, inject, input } from "@angular/core";
import { spacing } from "@copilotkit/shared/generative-ui";
import type { GenerativeUIChildren } from "../../children";
import { CopilotGenerativeUIChildren } from "../../children.directive";
import { GenerativeUIStyles } from "../../styles";
import type { GenerativeUIEventProp } from "../context";
import { provideContainerContext } from "../context";
import { layoutStyle } from "../style";
import type { StyleMap } from "../style";
import { CopilotGenerativeUILayoutInputs } from "./layout-inputs";

/** A layout container that is a form. It sends `onSubmit` when submitted. */
@Component({
  selector: "form[copilotGenerativeUIForm]",
  imports: [CopilotGenerativeUIChildren],
  providers: [provideContainerContext()],
  template: `
    <ng-container *copilotGenerativeUIChildren="children()" />
  `,
  host: {
    "[attr.aria-label]": "label() ?? null",
    "[style]": "style()",
    "(submit)": "onSubmitHost($event)",
  },
})
export class CopilotGenerativeUIForm extends CopilotGenerativeUILayoutInputs {
  readonly label = input<string>();
  readonly onSubmit = input<GenerativeUIEventProp>();
  readonly children = input<GenerativeUIChildren>();

  protected readonly style = computed<StyleMap>(() => ({
    flexDirection: "column",
    ...layoutStyle(this.layoutProps()),
    gap: spacing(this.gap() ?? 4),
  }));

  constructor() {
    super();
    inject(GenerativeUIStyles).ensureStandard();
  }

  protected onSubmitHost(event: Event) {
    event.preventDefault();
    void this.onSubmit()?.({});
  }
}
