import { onBeforeUnmount, onMounted, readonly, ref, type Ref } from "vue";

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
  const initialHeight = typeof window !== "undefined" ? window.innerHeight : 0;
  const isKeyboardOpen = ref(false);
  const keyboardHeight = ref(0);
  const availableHeight = ref(initialHeight);
  const viewportHeight = ref(initialHeight);

  const updateKeyboardState = () => {
    if (typeof window === "undefined") return;
    const visualViewport = window.visualViewport;
    if (!visualViewport) return;

    const layoutHeight = window.innerHeight;
    const visualHeight = visualViewport.height;

    // Keyboard height = layout viewport minus visual viewport, clamped to 0.
    const nextKeyboardHeight = Math.max(0, layoutHeight - visualHeight);
    // Only treat the keyboard as open past the 150px threshold, matching
    // the React implementation's mobile heuristic.
    const nextIsOpen = nextKeyboardHeight > 150;

    keyboardHeight.value = nextKeyboardHeight;
    isKeyboardOpen.value = nextIsOpen;
    availableHeight.value = visualHeight;
    viewportHeight.value = layoutHeight;
  };

  let visualViewport: VisualViewport | null = null;

  onMounted(() => {
    if (typeof window === "undefined") return;
    visualViewport = window.visualViewport ?? null;
    if (!visualViewport) return;

    updateKeyboardState();

    visualViewport.addEventListener("resize", updateKeyboardState);
    visualViewport.addEventListener("scroll", updateKeyboardState);
  });

  onBeforeUnmount(() => {
    if (!visualViewport) return;
    visualViewport.removeEventListener("resize", updateKeyboardState);
    visualViewport.removeEventListener("scroll", updateKeyboardState);
    visualViewport = null;
  });

  return {
    isKeyboardOpen: readonly(isKeyboardOpen),
    keyboardHeight: readonly(keyboardHeight),
    availableHeight: readonly(availableHeight),
    viewportHeight: readonly(viewportHeight),
  };
}
