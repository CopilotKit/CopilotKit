import { ɵinspectorShortcuts } from "@copilotkit/core";
import { onBeforeUnmount, readonly, ref } from "vue";
import type { Ref } from "vue";

/**
 * Whether the user hid the Inspector buttons in the message toolbars ("Hide
 * this icon"), until the page reloads. Core's `ɵinspectorShortcuts` holds
 * the page-lifetime preference.
 * @internal
 */
export function useInspectorShortcutsHidden(): Readonly<Ref<boolean>> {
  const hidden = ref(ɵinspectorShortcuts.hidden);
  const unsubscribe = ɵinspectorShortcuts.subscribe(() => {
    hidden.value = ɵinspectorShortcuts.hidden;
  });
  onBeforeUnmount(unsubscribe);
  return readonly(hidden);
}

/** Hides the Inspector buttons of every message until the page reloads. */
export function hideInspectorShortcuts(): void {
  ɵinspectorShortcuts.hide();
}

/** @internal Shows the buttons again, so each test starts fresh. */
export function ɵresetInspectorShortcuts(): void {
  ɵinspectorShortcuts.reset();
}
