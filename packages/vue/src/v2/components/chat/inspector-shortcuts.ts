import { onBeforeUnmount, readonly, ref } from "vue";
import type { Ref } from "vue";

// Page-lifetime preference, shared by every message and chat. Deliberately
// avoid sessionStorage: it survives reloads, while this preference must not.
let shortcutsHidden = false;
const listeners = new Set<() => void>();

/**
 * Whether the user hid the Inspector buttons in the message toolbars ("Hide
 * this icon"), until the page reloads.
 * @internal
 */
export function useInspectorShortcutsHidden(): Readonly<Ref<boolean>> {
  const hidden = ref(shortcutsHidden);
  const listener = () => {
    hidden.value = shortcutsHidden;
  };
  listeners.add(listener);
  onBeforeUnmount(() => listeners.delete(listener));
  return readonly(hidden);
}

/** Hides the Inspector buttons of every message until the page reloads. */
export function hideInspectorShortcuts(): void {
  shortcutsHidden = true;
  listeners.forEach((listener) => listener());
}

/** @internal Shows the buttons again, so each test starts fresh. */
export function ɵresetInspectorShortcuts(): void {
  shortcutsHidden = false;
  listeners.forEach((listener) => listener());
}
