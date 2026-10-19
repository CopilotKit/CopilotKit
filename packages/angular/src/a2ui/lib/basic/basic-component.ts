import { Directive, computed, input } from "@angular/core";
import { ComponentApi } from "@a2ui/web_core/v0_9";
import { BasicProps } from "./shared";

/**
 * Base of the basic catalog components, as in the A2UI Angular renderer. Each
 * component's host is its own box, so A2UI `weight` is its flex grow factor
 * inside a Row or Column.
 */
@Directive({
  host: { "[style.flex]": "weight()" },
})
export abstract class CopilotA2UIBasicComponent<Api extends ComponentApi> {
  readonly props = input.required<BasicProps<Api>>();

  protected readonly weight = computed(
    () => (this.props() as { weight?: number }).weight ?? null,
  );
}
