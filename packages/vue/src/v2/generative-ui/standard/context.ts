import { computed, inject, provide, toRef, toValue } from "vue";
import type { InjectionKey, MaybeRefOrGetter, Ref } from "vue";
import type { GenerativeUIInvokeResult } from "@copilotkit/shared/generative-ui";

// The Card context of the standard components. A surface has only one
// bordered level (the outer Card), and the default gap of a container
// depends on how far it is from that Card. Card and the containers provide
// these values; the components below them read them. The values are refs,
// so a Card whose `variant` streams in updates its children.

/** True inside a Card. */
const GENERATIVE_UI_CARD_NESTING: InjectionKey<Readonly<Ref<boolean>>> = Symbol(
  "GENERATIVE_UI_CARD_NESTING",
);

/** The count of containers from the nearest Card, or `null` outside a Card. */
const GENERATIVE_UI_CARD_DISTANCE: InjectionKey<Readonly<Ref<number | null>>> =
  Symbol("GENERATIVE_UI_CARD_DISTANCE");

/**
 * True inside a Card. Everything inside a Card becomes borderless columns
 * or the one near-white inner panel. `false` outside a Card.
 */
export function useCardNesting() {
  return inject(GENERATIVE_UI_CARD_NESTING, () => toRef(false), true);
}

/**
 * The count of containers from the nearest Card, or `null` outside a Card.
 * The rhythm: 16px between the groups directly inside a Card, 8px in a
 * group (label and control, caption and value).
 */
export function useCardDistance() {
  return inject(
    GENERATIVE_UI_CARD_DISTANCE,
    () => toRef<number | null>(null),
    true,
  );
}

/**
 * Makes the component a Card for its children: they are at distance 0.
 * Call it in the `setup` of Card.
 *
 * @param nested - Whether the children are nested in a Card. A Card that
 *   draws a box passes `true`. A section draws no box, so it passes the
 *   nesting of its parent (`useCardNesting()`).
 *
 * @example
 * ```ts
 * const parentNesting = useCardNesting();
 * provideCardContext(() =>
 *   props.variant === "section" ? parentNesting.value : true,
 * );
 * ```
 */
export function provideCardContext(nested: MaybeRefOrGetter<boolean>) {
  provide(
    GENERATIVE_UI_CARD_NESTING,
    computed(() => toValue(nested)),
  );
  provide(GENERATIVE_UI_CARD_DISTANCE, toRef(0));
}

/**
 * Makes the component a container: its children are one level further from
 * the Card. Outside a Card, the distance stays `null`. Call it in the
 * `setup` of a container (Row, Column, Grid, Form, and so on).
 *
 * @returns The distance of the container itself, for its own default gap.
 */
export function provideContainerContext() {
  const distance = useCardDistance();
  provide(
    GENERATIVE_UI_CARD_DISTANCE,
    computed(() => (distance.value === null ? null : distance.value + 1)),
  );
  return distance;
}

/**
 * A bound event of a standard component, as the node binds it: a function
 * while the agent bound the event, else `undefined`. All groups use this
 * shape. A component without arguments calls it with `{}`.
 */
export type GenerativeUIEventProp<
  Args extends Record<string, unknown> = Record<string, unknown>,
> = (args?: Args) => Promise<GenerativeUIInvokeResult>;
