import { InjectionToken, inject } from "@angular/core";
import type { Provider } from "@angular/core";
import type { GenerativeUIInvokeResult } from "@copilotkit/shared/generative-ui";

/**
 * True inside a Card. A surface has only one bordered level (the outer
 * Card). Everything inside it becomes borderless columns or the one
 * near-white inner panel. A Card provides it, children inject it.
 */
export const GENERATIVE_UI_CARD_NESTING = new InjectionToken<boolean>(
  "GENERATIVE_UI_CARD_NESTING",
  { factory: () => false },
);

/**
 * The count of containers from the nearest Card, or `null` outside of a
 * Card. The rhythm: 16px between the groups directly inside a Card, 8px in a
 * group (label and control, caption and value).
 */
export const GENERATIVE_UI_CARD_DISTANCE = new InjectionToken<number | null>(
  "GENERATIVE_UI_CARD_DISTANCE",
  { factory: () => null },
);

/** The providers of a Card: its children are nested, at distance 0. */
export function provideCardContext(): Provider[] {
  return [
    { provide: GENERATIVE_UI_CARD_NESTING, useValue: true },
    { provide: GENERATIVE_UI_CARD_DISTANCE, useValue: 0 },
  ];
}

/** The providers of a container: its children are one level further from the Card. */
export function provideContainerContext(): Provider[] {
  return [
    {
      provide: GENERATIVE_UI_CARD_DISTANCE,
      useFactory: () => {
        const distance = inject(GENERATIVE_UI_CARD_DISTANCE, {
          skipSelf: true,
          optional: true,
        });
        return distance === null || distance === undefined
          ? null
          : distance + 1;
      },
    },
  ];
}

/**
 * A bound event of a standard component, as the node binds it: a function
 * while the agent bound the event, else `undefined`. The one shape for all
 * groups; a component without arguments calls it with `{}`.
 */
export type GenerativeUIEventProp<
  Args extends Record<string, unknown> = Record<string, unknown>,
> = (args?: Args) => Promise<GenerativeUIInvokeResult>;
