import React, { Suspense, lazy } from "react";
import type { CopilotThreadsDrawerProps } from "./CopilotThreadsDrawer";

/**
 * The `threadsDrawer` prop of `<CopilotPopup>` / `<CopilotSidebar>` (and their
 * views): `true` for the default drawer, an object to configure it, or
 * `false` / omitted for none.
 */
export type ModalThreadsDrawerProp = boolean | CopilotThreadsDrawerProps;

/**
 * Resolves a {@link ModalThreadsDrawerProp} to the drawer props to render, or
 * `null` when the drawer is off.
 */
export function resolveModalThreadsDrawerProps(
  threadsDrawer: ModalThreadsDrawerProp | undefined,
): CopilotThreadsDrawerProps | null {
  if (!threadsDrawer) return null;
  return threadsDrawer === true ? {} : threadsDrawer;
}

// Loaded on demand: the drawer pulls in the Lit custom element, which popup and
// sidebar users who never opt in shouldn't have to download.
const LazyCopilotThreadsDrawer = lazy(() =>
  import("./CopilotThreadsDrawer").then((module) => ({
    default: module.CopilotThreadsDrawer,
  })),
);

/**
 * The threads drawer hosted inside a chat modal. Render it as a direct child
 * of the modal's positioned container, inside a `ModalThreadsDrawerScope`: the
 * scope makes the drawer an overlay panel (it covers the container and slides
 * in from its left edge) with open state local to the modal.
 */
export function ModalThreadsDrawer(props: CopilotThreadsDrawerProps) {
  return (
    <Suspense fallback={null}>
      <LazyCopilotThreadsDrawer {...props} />
    </Suspense>
  );
}
