/**
 * Web Component catalog entries, copied from `@a2ui/web_core/v0_9/universal`.
 *
 * TODO: delete this file once `@a2ui/web_core` is upgraded to 0.11.0 or later,
 * and import `WebComponentImplementation`, `A2uiWebComponentElement`,
 * `isWebComponentImplementation` and `registerUniversalElement` from
 * `@a2ui/web_core/v0_9/universal` instead. We pin 0.10.4, which predates them.
 */
import { ComponentApi, ComponentContext } from "@a2ui/web_core/v0_9";

/** A catalog entry rendered by a Custom Element. */
export interface WebComponentImplementation extends ComponentApi {
  /** The tag name the element is registered under. */
  readonly tagName: string;
  /** The Custom Element class. */
  readonly element: CustomElementConstructor;
}

/**
 * The contract a catalog Custom Element fulfills: the renderer assigns
 * `context` after creating it, and the element binds itself from there.
 */
export interface A2uiWebComponentElement extends HTMLElement {
  context?: ComponentContext;
}

export function isWebComponentImplementation(
  api: unknown,
): api is WebComponentImplementation {
  return (
    typeof api === "object" &&
    api !== null &&
    typeof (api as { tagName?: unknown }).tagName === "string" &&
    typeof (api as { element?: unknown }).element === "function"
  );
}

let missingCustomElementsReported = false;

/**
 * Defines the entry's Custom Element. Registering the same element again is a
 * no-op; a different element under the same tag name throws. Without
 * `customElements` (server rendering) it reports once and does nothing.
 */
export function registerUniversalElement(
  component: WebComponentImplementation,
): void {
  if (typeof customElements === "undefined") {
    if (!missingCustomElementsReported) {
      missingCustomElementsReported = true;
      console.error(
        `Cannot register "${component.tagName}": \`customElements\` is not available in this ` +
          "environment, so universal components will not render.",
      );
    }
    return;
  }

  const existing = customElements.get(component.tagName);
  if (!existing) {
    customElements.define(component.tagName, component.element);
    return;
  }

  if (existing !== component.element) {
    throw new Error(
      `Custom element tag name collision for "${component.tagName}": ` +
        `attempted to register ${component.element.name || "anonymous constructor"}, ` +
        `but tag name is already registered with ${existing.name || "another constructor"}.`,
    );
  }
}
