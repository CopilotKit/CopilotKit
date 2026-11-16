// Helper for the CopilotChat slot overrides. The slot prop types in
// `@copilotkit/react-core` are typed against the *exact* default component,
// but a custom wrapper that returns a structurally compatible ReactElement
// works the same as a drop-in. This helper names that fact and keeps the type
// assertion in one place: readers see `makeSlotOverride` and know it is about
// the slot contract. Once the slot prop types accept structural compatibility,
// this helper can be deleted and the casts go away.

import type { ComponentType } from "react";

// `any` on the input is intentional: the helper accepts any component shape
// and asserts it as the slot's expected type. A stricter constraint would
// defeat its purpose.
export function makeSlotOverride<TDefault>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>,
) {
  return component as TDefault;
}
