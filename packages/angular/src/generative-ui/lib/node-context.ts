import { InjectionToken, computed, inject } from "@angular/core";
import type { Signal } from "@angular/core";
import { accessibilityAttributes } from "@copilotkit/core/generative-ui";
import type {
  GenerativeUIAccessibility,
  GenerativeUIAriaAttributes,
} from "@copilotkit/core/generative-ui";

/** What the renderer tells the component it renders. */
export interface GenerativeUINodeContext {
  surfaceKey: string;
  surfaceId: string;
  componentId: string;
  /** The resolved `accessibility` of the component envelope, if any. */
  accessibility: Signal<GenerativeUIAccessibility | undefined>;
}

/** The node context of the component being rendered. Absent outside of generated UI. */
export const GENERATIVE_UI_NODE_CONTEXT =
  new InjectionToken<GenerativeUINodeContext>("GENERATIVE_UI_NODE_CONTEXT");

const NO_ARIA: GenerativeUIAriaAttributes = {};

/**
 * Experimental. The ARIA attributes of the `accessibility` that the model
 * gave the component being rendered, to bind on its root element. The
 * standard components do this; a custom component does it itself:
 *
 * @example
 * ```ts
 * @Component({ host: { "[attr.aria-label]": "aria()['aria-label']" } })
 * export class Panel {
 *   protected readonly aria = injectGenerativeUIAccessibility();
 * }
 * ```
 *
 * Outside of generated UI it gives `{}`.
 */
export function injectGenerativeUIAccessibility(): Signal<GenerativeUIAriaAttributes> {
  const node = inject(GENERATIVE_UI_NODE_CONTEXT, { optional: true });
  if (!node) return computed(() => NO_ARIA);
  return computed(() => accessibilityAttributes(node.accessibility()));
}
