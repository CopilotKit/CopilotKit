import { Component, computed, input } from "@angular/core";
import { toChildRef } from "./child-ref";
import { injectA2UIComponentContext } from "./component-context";
import { CopilotA2UINode } from "./node";
import type { A2UIChildRef } from "./types";

/**
 * Renders a child of the current catalog component.
 *
 * @example
 * ```html
 * <copilot-a2ui-child [child]="props().child" />
 * @for (child of props().children; track child.id) {
 *   <copilot-a2ui-child [child]="child" />
 * }
 * ```
 */
@Component({
  selector: "copilot-a2ui-child",
  imports: [CopilotA2UINode],
  host: { style: "display: contents" },
  template: `
    @if (reference(); as reference) {
      <copilot-a2ui-node
        [surface]="context.surface"
        [componentId]="reference.id"
        [basePath]="reference.basePath"
      />
    }
  `,
})
export class CopilotA2UIChild {
  /** A child id, or a `{ id, basePath }` reference from a resolved child list. */
  readonly child = input<A2UIChildRef>();

  protected readonly context = injectA2UIComponentContext();

  protected readonly reference = computed(() => {
    const child = this.child();
    return child ? toChildRef(child, this.context.basePath) : undefined;
  });
}
