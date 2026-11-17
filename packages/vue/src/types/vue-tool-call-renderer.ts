import type {
  ToolCallRenderProps,
  ToolCallRendererDef,
} from "@copilotkit/core";
import type { Component, VNodeChild } from "vue";

/**
 * Props passed to a Vue tool call render function. Same as core's
 * `ToolCallRenderProps`.
 *
 * @typeParam T - The shape of the tool arguments.
 */
export type VueToolCallRendererRenderProps<T> = ToolCallRenderProps<T>;

/**
 * Vue component or render function for tool call rendering.
 * Component is normalized to (props) => VNodeChild internally.
 */
export type VueToolCallRendererRenderFn<T> =
  | ((props: VueToolCallRendererRenderProps<T>) => VNodeChild)
  | Component<VueToolCallRendererRenderProps<T>>;

type VueToolCallRendererDef<T> = ToolCallRendererDef<
  T,
  VueToolCallRendererRenderFn<T>
>;

/**
 * A Vue tool call renderer registration: core's `ToolCallRendererDef` with a
 * Vue render function. `args` is required here. Use `defineToolCallRenderer`
 * to build one; it fills in `args` for a `"*"` renderer that has no schema.
 *
 * @typeParam T - The shape of the tool arguments.
 */
export type VueToolCallRenderer<T = unknown> = VueToolCallRendererDef<T> &
  Required<Pick<VueToolCallRendererDef<T>, "args">>;
