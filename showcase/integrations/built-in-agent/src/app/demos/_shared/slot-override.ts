// Helper for the CopilotChat slot overrides. The slot prop types in
// `@copilotkit/react-core` are nominally typed against the *exact*
// default component identity, but a custom wrapper that returns a
// structurally compatible ReactElement is functionally a drop-in. This
// helper names that fact and centralizes the type assertion in one
// place — readers see `makeSlotOverride` and know it's about the slot
// contract, not arbitrary type-system gymnastics. Once the slot prop
// types accept structural compatibility, this helper can be deleted
// and the casts will resolve automatically.

import type { ComponentType } from "react";

// `any` on the input is intentional: the helper's purpose is to accept
// any component shape and assert it as the slot's expected type. A
// stricter constraint would defeat the whole point.
export function makeSlotOverride<TDefault>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>,
): TDefault {
  return component as unknown as TDefault;
}
