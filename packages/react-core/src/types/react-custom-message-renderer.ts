import type React from "react";
import type {
  CustomMessageRendererDef,
  CustomMessageRendererPosition,
  CustomMessageRenderProps,
} from "@copilotkit/core";

/** Where a custom message renderer draws, relative to its message. */
export type ReactCustomMessageRendererPosition = CustomMessageRendererPosition;

/**
 * Props a React custom message renderer receives: the same as
 * {@link CustomMessageRenderProps}, with `stateSnapshot` typed `any` so a
 * component can read the agent state without a cast.
 */
type ReactCustomMessageRenderProps = Omit<
  CustomMessageRenderProps,
  "stateSnapshot"
> & {
  stateSnapshot: any;
};

/**
 * A custom message renderer for React: a component that draws before or
 * after each chat message. Return `null` from the component to draw nothing
 * for a message. A `null` render is skipped.
 */
export type ReactCustomMessageRenderer =
  CustomMessageRendererDef<React.ComponentType<ReactCustomMessageRenderProps> | null>;
