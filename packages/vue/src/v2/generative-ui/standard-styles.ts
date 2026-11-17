import { computed, onBeforeMount, toValue } from "vue";
import type { MaybeRefOrGetter } from "vue";
import {
  STANDARD_CSS,
  STANDARD_STYLE_ID,
  themeStyleSheet,
} from "@copilotkit/shared/generative-ui";
import type { GenerativeUITheme } from "@copilotkit/shared/generative-ui";

/**
 * Adds the standard stylesheet to the document once. Every standard
 * component calls it in its `setup`, so a host does not have to import a
 * CSS file. It runs before the component mounts, so nothing is added on the
 * server.
 *
 * @example
 * ```ts
 * setup() {
 *   useStandardStyles();
 * }
 * ```
 */
export function useStandardStyles() {
  onBeforeMount(() => {
    if (document.getElementById(STANDARD_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STANDARD_STYLE_ID;
    style.textContent = STANDARD_CSS;
    document.head.appendChild(style);
  });
}

/**
 * The stylesheet of a theme for a surface root, as a computed ref: an `id`
 * for the root's `data-a2ui-theme` attribute, and the `css` that sets the
 * `--a2ui-*` variables of that id, with the `dark` values in dark mode only.
 * Its value is `undefined` when the theme sets no variable.
 *
 * @param theme - The theme, as a plain value, a ref, or a getter.
 *
 * @example
 * ```ts
 * const sheet = useThemeStyleSheet(() => runtime.value.theme);
 * ```
 */
export function useThemeStyleSheet(
  theme: MaybeRefOrGetter<GenerativeUITheme | undefined>,
) {
  return computed(() => themeStyleSheet(toValue(theme)));
}
