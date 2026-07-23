import {
  COPILOTKIT_THREADS_DRAWER_TAG,
  CopilotKitThreadsDrawer,
} from "./copilotkit-threads-drawer";

/**
 * Registers the `<copilotkit-threads-drawer>` custom element. Idempotent — safe to call
 * multiple times (e.g. from several framework wrappers in the same page); a
 * second registration of the same tag is a no-op.
 */
export function defineCopilotKitThreadsDrawer(): void {
  if (
    typeof customElements !== "undefined" &&
    !customElements.get(COPILOTKIT_THREADS_DRAWER_TAG)
  ) {
    customElements.define(
      COPILOTKIT_THREADS_DRAWER_TAG,
      CopilotKitThreadsDrawer,
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "copilotkit-threads-drawer": CopilotKitThreadsDrawer;
  }
}
