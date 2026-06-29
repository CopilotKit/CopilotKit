import { COPILOTKIT_DRAWER_TAG, CopilotKitDrawer } from "./copilotkit-drawer";

/**
 * Registers the `<copilotkit-drawer>` custom element. Idempotent — safe to call
 * multiple times (e.g. from several framework wrappers in the same page); a
 * second registration of the same tag is a no-op.
 */
export function defineCopilotKitDrawer(): void {
  if (
    typeof customElements !== "undefined" &&
    !customElements.get(COPILOTKIT_DRAWER_TAG)
  ) {
    customElements.define(COPILOTKIT_DRAWER_TAG, CopilotKitDrawer);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "copilotkit-drawer": CopilotKitDrawer;
  }
}
