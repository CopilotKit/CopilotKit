import type { FrontendTool, HumanInTheLoopRenderProps } from "@copilotkit/core";
import type { Component, VNodeChild } from "vue";

/**
 * Props a Vue human-in-the-loop renderer receives. Same as core's
 * `HumanInTheLoopRenderProps`.
 *
 * @typeParam T - The shape of the tool arguments.
 */
export type VueHumanInTheLoopRenderProps<T> = HumanInTheLoopRenderProps<T>;

export type VueHumanInTheLoopRenderFn<T> =
  | ((props: VueHumanInTheLoopRenderProps<T>) => VNodeChild)
  | Component<VueHumanInTheLoopRenderProps<T>>;

export type VueHumanInTheLoop<
  T extends Record<string, unknown> = Record<string, unknown>,
> = Omit<FrontendTool<T>, "handler"> & {
  render: VueHumanInTheLoopRenderFn<T>;
};
