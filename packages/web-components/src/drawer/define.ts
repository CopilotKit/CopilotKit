import { CopilotkitDrawer, COPILOTKIT_DRAWER_TAG } from "./copilotkit-drawer";

/**
 * Idempotently register `<copilotkit-drawer>` with the custom element registry.
 *
 * Safe to call multiple times; subsequent calls are no-ops once the element is
 * defined. Returns the registered constructor.
 */
export function defineCopilotkitDrawer(): typeof CopilotkitDrawer {
  if (
    typeof customElements !== "undefined" &&
    !customElements.get(COPILOTKIT_DRAWER_TAG)
  ) {
    customElements.define(COPILOTKIT_DRAWER_TAG, CopilotkitDrawer);
  }
  return CopilotkitDrawer;
}

declare global {
  interface HTMLElementTagNameMap {
    "copilotkit-drawer": CopilotkitDrawer;
  }
}
