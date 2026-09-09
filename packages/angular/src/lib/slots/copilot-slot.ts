import {
  Component,
  TemplateRef,
  Type,
  ViewContainerRef,
  computed,
  effect,
  input,
  untracked,
  viewChild,
} from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { SlotOutputs } from "./slot.types";
import { slotBindings, slotInputNames } from "./slot.utils";

/**
 * @internal - This component is for internal use only.
 * Renders a slot override, a default component, or the projected fallback.
 *
 * - A `TemplateRef` slot is rendered with `context` as its template context,
 *   so context keys are available as `let-` variables.
 * - A component slot (or `defaultComponent`) is created with `context` keys
 *   bound to its matching inputs and `outputs` handlers bound to its matching
 *   outputs. Bound values stay live; the component is only recreated when the
 *   resolved type or set of bound input names changes.
 * - With neither a slot nor a default component, the projected content shows.
 *
 * @example
 * ```html
 * <copilot-slot [slot]="sendButtonTemplate" [context]="buttonContext">
 *   <button class="default-btn">Default</button>
 * </copilot-slot>
 * ```
 */
@Component({
  selector: "copilot-slot",
  imports: [NgTemplateOutlet],
  template: `
    @if (template(); as tpl) {
      <ng-container *ngTemplateOutlet="tpl; context: context()" />
    }
    <ng-container #host />
    @if (!slot() && !defaultComponent()) {
      <ng-content />
    }
  `,
})
export class CopilotSlot {
  readonly slot = input<TemplateRef<unknown> | Type<unknown>>();
  readonly context = input<object>();
  readonly defaultComponent = input<Type<unknown>>();
  readonly outputs = input<SlotOutputs>();

  private readonly host = viewChild.required("host", {
    read: ViewContainerRef,
  });

  protected readonly template = computed(() => {
    const slot = this.slot();
    return slot instanceof TemplateRef ? slot : undefined;
  });

  private readonly componentType = computed(() => {
    const slot = this.slot();
    return slot instanceof TemplateRef
      ? undefined
      : (slot ?? this.defaultComponent());
  });

  private readonly inputNames = computed(
    () => {
      const type = this.componentType();
      return type ? slotInputNames(type, this.context()) : [];
    },
    {
      equal: (previous, current) =>
        previous.length === current.length &&
        previous.every((name, index) => name === current[index]),
    },
  );

  constructor() {
    effect((onCleanup) => {
      const type = this.componentType();
      if (!type) return;
      const inputNames = this.inputNames();
      const ref = untracked(() =>
        this.host().createComponent(type, {
          bindings: slotBindings(
            type,
            inputNames,
            () => this.context(),
            () => this.outputs(),
          ),
        }),
      );
      onCleanup(() => ref.destroy());
    });
  }
}
