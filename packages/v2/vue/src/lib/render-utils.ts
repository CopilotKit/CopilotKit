import { h, type Component, type VNodeChild } from "vue";
import type { VueToolCallRendererRenderProps } from "../types";

/**
 * Normalize a Vue component or render function to a render function.
 * If Component is provided, returns (props) => h(Component, props).
 */
export function normalizeVueRenderer<T>(
  render:
    | ((props: VueToolCallRendererRenderProps<T>) => VNodeChild)
    | Component<VueToolCallRendererRenderProps<T>>,
): (props: VueToolCallRendererRenderProps<T>) => VNodeChild {
  if (typeof render === "function" && render.length > 0) {
    return render as (props: VueToolCallRendererRenderProps<T>) => VNodeChild;
  }
  return (props: VueToolCallRendererRenderProps<T>) =>
    h(render as Component, props);
}
