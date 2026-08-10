import type React from "react";
import type { ReactToolCallRenderer } from "@copilotkit/react-core/v2/headless";

/**
 * Props a React Native render function receives for a tool call.
 *
 * DERIVED from react-core's canonical `ReactToolCallRenderer` contract rather
 * than declared separately. This is deliberate: RN and web previously each
 * declared their own shape and drifted — RN's `status` was a two-member
 * `"executing" | "complete"` union with no `"inProgress"` state, RN omitted
 * `name`/`toolCallId` entirely, and RN's `args` was unconditionally the full
 * `T`, promising complete arguments even before they had finished streaming.
 * Deriving makes that class of drift impossible — if web's contract changes,
 * RN's public type changes with it and `check-types` says so.
 *
 * `status` is a discriminated union: `args` is `Partial<T>` only while
 * `"inProgress"`, and `result` is a string only when `"complete"`.
 */
export type RenderToolProps<T = Record<string, unknown>> = React.ComponentProps<
  ReactToolCallRenderer<T>["render"]
>;

/**
 * A render function returning a React Native element.
 *
 * This is the one place RN legitimately narrows web's contract: `FlatList`'s
 * `renderItem` cannot render strings or portals, so RN requires
 * `ReactElement | null` where web permits any `ReactNode`. The PROPS are shared;
 * only the return type is platform-specific.
 */
export type RenderToolFunction<T = Record<string, unknown>> = (
  props: RenderToolProps<T>,
) => React.ReactElement | null;
