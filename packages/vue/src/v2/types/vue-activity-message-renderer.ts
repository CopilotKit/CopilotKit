import type {
  ActivityMessageRenderProps,
  ActivityMessageRendererDef,
} from "@copilotkit/core";
import type { Component, VNodeChild } from "vue";

/**
 * Props a Vue activity message renderer receives. Same as core's
 * `ActivityMessageRenderProps`.
 *
 * @typeParam TActivityContent - The shape of the activity content.
 */
export type VueActivityMessageRendererProps<TActivityContent> =
  ActivityMessageRenderProps<TActivityContent>;

export type VueActivityMessageRendererRenderFn<TActivityContent> =
  | ((props: VueActivityMessageRendererProps<TActivityContent>) => VNodeChild)
  | Component<VueActivityMessageRendererProps<TActivityContent>>;

/**
 * A Vue activity message renderer registration. `content` takes any
 * Standard Schema (zod, valibot, arktype, and so on). The chat validates the
 * activity content with it and passes the result to `render`.
 *
 * @typeParam TActivityContent - The shape of the activity content.
 */
export type VueActivityMessageRenderer<TActivityContent> =
  ActivityMessageRendererDef<
    TActivityContent,
    VueActivityMessageRendererRenderFn<TActivityContent>
  >;
