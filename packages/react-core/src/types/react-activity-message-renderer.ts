import type React from "react";
import type {
  ActivityMessageRenderProps,
  ActivityMessageRendererDef,
} from "@copilotkit/core";

/**
 * An activity message renderer for React: a React component that draws
 * activity messages of one `activityType` (or `"*"` for any type). The
 * component receives {@link ActivityMessageRenderProps}.
 *
 * @typeParam TActivityContent - The shape of the activity content.
 */
export type ReactActivityMessageRenderer<TActivityContent> =
  ActivityMessageRendererDef<
    TActivityContent,
    React.ComponentType<ActivityMessageRenderProps<TActivityContent>>
  >;
