import { inject, provide } from "vue";
import type { InjectionKey, Ref, ShallowRef } from "vue";

/** What a PopoverTrigger and a PopoverContent read from their Popover. */
export interface GenerativeUIPopoverState {
  /** True while the Popover is open. */
  isOpen: Readonly<Ref<boolean>>;
  /** Opens or closes the Popover. */
  setOpen: (value: boolean) => void;
  /** The `id` of the trigger button. The content is labelled by it. */
  triggerId: string;
  /** The `id` of the content. The trigger controls it. */
  contentId: string;
  /** The trigger button, set by the PopoverTrigger. Escape focuses it. */
  triggerElement: ShallowRef<HTMLElement | null>;
}

const GENERATIVE_UI_POPOVER: InjectionKey<GenerativeUIPopoverState> = Symbol(
  "GENERATIVE_UI_POPOVER",
);

/**
 * Makes the component the Popover of the PopoverTrigger and the
 * PopoverContent below it. Call it in the `setup` of Popover.
 *
 * @param state - The open state, the ids and the trigger element.
 */
export function providePopover(state: GenerativeUIPopoverState) {
  provide(GENERATIVE_UI_POPOVER, state);
}

/**
 * The state of the nearest Popover, or `null` outside a Popover. Call it in
 * the `setup` of PopoverTrigger and PopoverContent.
 */
export function injectPopover() {
  return inject(GENERATIVE_UI_POPOVER, null);
}
