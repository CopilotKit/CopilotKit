import * as vue from "vue";

// `useId` is new in Vue 3.5. The package supports Vue 3.3 and later, so it
// is read from the namespace: on 3.3 and 3.4 it is undefined, not an import
// error.
const vueUseId: (() => string) | undefined = vue.useId;

let fallbackCount = 0;

/**
 * An id for the ARIA links of a standard component (labels, popups, tabs).
 * On Vue 3.5 and later it is `useId()`, so server and client render the same
 * id. On older Vue it comes from a module counter. Call it in `setup`.
 */
export function useStandardId(): string {
  return vueUseId ? vueUseId() : `a2ui-${++fallbackCount}`;
}
