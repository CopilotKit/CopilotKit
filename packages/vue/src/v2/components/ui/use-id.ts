import * as vue from "vue";

let counter = 0;

/**
 * A unique id for ARIA references. Uses Vue's SSR-safe `useId()` on Vue 3.5+;
 * the peer range starts at 3.3, which has none, so older Vue gets a counter.
 * Read through the namespace, so a Vue without the export does not fail to
 * import this module.
 * @internal
 */
export function useCopilotId(prefix = "cpk"): string {
  const vueUseId = (vue as { useId?: () => string }).useId;
  const id = vueUseId?.();
  return id ? `${prefix}-${id}` : `${prefix}-${++counter}`;
}
