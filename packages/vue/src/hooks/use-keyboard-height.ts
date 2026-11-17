import { onBeforeUnmount, onMounted, readonly, ref } from "vue";
import type { Ref } from "vue";
import { ɵinitialKeyboardState, ɵwatchKeyboardState } from "@copilotkit/core";

/**
 * Vue-idiomatic result of {@link useKeyboardHeight}. Fields mirror the React
 * `KeyboardState` shape (`isKeyboardOpen`, `keyboardHeight`, `availableHeight`,
 * `viewportHeight`) and are exposed as readonly refs so consumers can bind them
 * reactively inside templates or computed values.
 */
export interface KeyboardState {
  isKeyboardOpen: Readonly<Ref<boolean>>;
  keyboardHeight: Readonly<Ref<number>>;
  availableHeight: Readonly<Ref<number>>;
  viewportHeight: Readonly<Ref<number>>;
}

/**
 * Composable to detect mobile keyboard appearance and calculate available
 * viewport height. Uses the Visual Viewport API to track keyboard state on
 * mobile devices.
 *
 * Mirrors the React `useKeyboardHeight` hook: returns `keyboardHeight` as the
 * difference between `window.innerHeight` and `visualViewport.height`, clamped
 * to `0`, and reports the keyboard as open when the diff exceeds `150` px.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { useKeyboardHeight } from "@copilotkit/vue";
 *
 * const { isKeyboardOpen, keyboardHeight } = useKeyboardHeight();
 * </script>
 * ```
 */
export function useKeyboardHeight(): KeyboardState {
  const initial = ɵinitialKeyboardState();
  const isKeyboardOpen = ref(initial.isKeyboardOpen);
  const keyboardHeight = ref(initial.keyboardHeight);
  const availableHeight = ref(initial.availableHeight);
  const viewportHeight = ref(initial.viewportHeight);
  let stopWatching: (() => void) | undefined;

  onMounted(() => {
    stopWatching = ɵwatchKeyboardState((state) => {
      keyboardHeight.value = state.keyboardHeight;
      isKeyboardOpen.value = state.isKeyboardOpen;
      availableHeight.value = state.availableHeight;
      viewportHeight.value = state.viewportHeight;
    });
  });

  onBeforeUnmount(() => {
    stopWatching?.();
    stopWatching = undefined;
  });

  return {
    isKeyboardOpen: readonly(isKeyboardOpen),
    keyboardHeight: readonly(keyboardHeight),
    availableHeight: readonly(availableHeight),
    viewportHeight: readonly(viewportHeight),
  };
}
