import type React from "react";
import type { ReactToolCallRenderer } from "@copilotkit/react-core/v2/headless";

/**
 * Props a React Native render function receives for a tool call.
 *
 * DERIVED from react-core's canonical `ReactToolCallRenderer` contract rather
 * than declared separately. This is deliberate: RN previously declared its own
 * shape and drifted from that contract — RN's `status` was a two-member
 * `"executing" | "complete"` union with no in-progress state, RN omitted
 * `name`/`toolCallId` entirely, and RN's `args` was unconditionally the full
 * `T`, promising complete arguments even before they had finished streaming.
 *
 * What the derivation buys, precisely: RN's props cannot drift from
 * `ReactToolCallRenderer` — the contract every registered renderer is
 * actually invoked against, and the type this alias reads through
 * `React.ComponentProps`. Change that contract and RN's public type changes
 * with it, so `check-types` names every RN renderer the change breaks.
 *
 * What it does NOT buy: parity with the type react-core *publicly exports*
 * under this same name. Web's `RenderToolProps<S>`
 * (react-core `src/v2/hooks/use-render-tool.tsx`) is a separate union, generic
 * over a schema rather than over the parsed args, carrying arguments under
 * `parameters` (not `args`) and declaring `status` as the string literals
 * `"inProgress"` / `"executing"` / `"complete"` rather than as `ToolCallStatus`
 * members. Both divergences are live today and nothing type-checks them shut:
 * the two types share no structural relation, and the one place they meet —
 * react-core's own bridge, which spreads the enum-typed renderer props into
 * the literal-typed slot — compiles because a string-enum member is
 * assignable to its own literal type (not the reverse). Web's `status` is a
 * widening of the canonical contract, not a derivation from it. RN's entry
 * point also re-exports web's three `RenderTool*Props` arms, so both shapes
 * ship under confusingly similar names.
 *
 * `status` is the discriminant of a three-arm union, typed as the
 * `ToolCallStatus` enum (`@copilotkit/core`), so narrow with the enum members
 * rather than the raw strings: `args` is `Partial<T>` only on
 * `ToolCallStatus.InProgress`, and `result` is a string only on
 * `ToolCallStatus.Complete`.
 */
export type RenderToolProps<T = Record<string, unknown>> = React.ComponentProps<
  ReactToolCallRenderer<T>["render"]
>;

/**
 * A render function returning a React Native element.
 *
 * This is the one place RN legitimately narrows `ReactToolCallRenderer`:
 * `FlatList`'s `renderItem` cannot render strings or portals, so RN requires
 * `ReactElement | null` where that contract permits any `ReactNode`. The PROPS
 * come from it unchanged; only the return type is platform-specific.
 */
export type RenderToolFunction<T = Record<string, unknown>> = (
  props: RenderToolProps<T>,
) => React.ReactElement | null;
