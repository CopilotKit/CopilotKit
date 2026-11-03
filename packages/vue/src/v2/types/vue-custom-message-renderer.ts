import type {
  CustomMessageRendererDef,
  CustomMessageRendererPosition,
  CustomMessageRenderProps,
} from "@copilotkit/core";
import type { Component, VNodeChild } from "vue";

/** Where a custom message renderer draws. Same as core's type. */
export type VueCustomMessageRendererPosition = CustomMessageRendererPosition;

/** Props a Vue custom message renderer receives. Same as core's type. */
export type VueCustomMessageRendererProps = CustomMessageRenderProps;

export type VueCustomMessageRendererRenderFn =
  | ((props: VueCustomMessageRendererProps) => VNodeChild)
  | Component<VueCustomMessageRendererProps>;

/** A Vue custom message renderer registration. */
export type VueCustomMessageRenderer =
  CustomMessageRendererDef<VueCustomMessageRendererRenderFn>;
