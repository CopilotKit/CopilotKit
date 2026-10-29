import { Component, computed, effect, inject, input } from "@angular/core";
import { GENERATIVE_UI_ROOT_ID } from "@copilotkit/shared";
import { themeStyleSheet } from "@copilotkit/shared/generative-ui";
import type { ManagedSurface } from "@copilotkit/core/generative-ui";
import { CopilotGenerativeUIChildren } from "./children.directive";
import type { GenerativeUIChildren } from "./children";
import { GENERATIVE_UI_RUNTIME } from "./runtime";
import { GenerativeUIStyles } from "./styles";

const NO_ANCESTORS: readonly string[] = [];

/**
 * Experimental. Renders one surface: its root component and everything
 * under it. The chat card and `<copilot-generative-ui-surface>` use it; a
 * custom chat card renders the surface it gets with it.
 *
 * The host is the surface root. `display: contents` keeps it out of the
 * layout, and the `--a2ui-*` variables of the theme still reach every
 * component. The `a2ui-surface` class scopes the standard stylesheet.
 */
@Component({
  selector: "copilot-generative-ui-surface-view",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <ng-container [copilotGenerativeUIChildren]="root()" />
  `,
  host: {
    class: "a2ui-surface",
    style: "display: contents",
    "[attr.data-generative-ui-root]": "surface().surfaceId",
    "[attr.data-a2ui-theme]": "sheet()?.id",
  },
})
export class CopilotGenerativeUISurfaceView {
  readonly surface = input.required<ManagedSurface>();

  readonly #runtime = inject(GENERATIVE_UI_RUNTIME);
  readonly #styles = inject(GenerativeUIStyles);

  /** The theme as a stylesheet, so its `dark` values apply in dark mode only. */
  protected readonly sheet = computed(() =>
    themeStyleSheet(this.#runtime.theme()),
  );

  protected readonly root = computed<GenerativeUIChildren>(() => ({
    surface: this.surface(),
    basePath: undefined,
    ancestors: NO_ANCESTORS,
    value: GENERATIVE_UI_ROOT_ID,
  }));

  constructor() {
    effect(() => {
      const sheet = this.sheet();
      if (sheet) this.#styles.ensure(`a2ui-theme-${sheet.id}`, sheet.css);
    });
  }
}
