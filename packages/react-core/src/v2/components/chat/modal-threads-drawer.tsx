import React, { Suspense, lazy, useEffect } from "react";
import {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "../../providers/CopilotChatConfigurationProvider";
import type { SlotValue } from "../../lib/slots";
import { renderSlot } from "../../lib/slots";
import type { CopilotThreadsDrawerProps } from "./CopilotThreadsDrawer";

/**
 * The `threadsDrawer` slot of `<CopilotPopup>` / `<CopilotSidebar>` (and their
 * views). Omitted or `false`: no drawer. `true`: the default
 * `CopilotThreadsDrawer`. Like other slots, a class name or an object of
 * `CopilotThreadsDrawer` props configures the default, and a component
 * replaces it.
 */
export type ModalThreadsDrawerProp =
  | boolean
  | SlotValue<React.ComponentType<CopilotThreadsDrawerProps>>;

/** Whether a {@link ModalThreadsDrawerProp} turns the drawer on. */
export function hasModalThreadsDrawer(
  threadsDrawer: ModalThreadsDrawerProp | undefined,
): boolean {
  return threadsDrawer !== undefined && threadsDrawer !== false;
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
 *
 * A replacement drawer renders inside the same scope, so it reads and sets its
 * open state with `useCopilotChatConfiguration()` (`drawerOpen`,
 * `setDrawerOpen`) and switches threads with `setActiveThreadId` /
 * `startNewThread`, like the default does.
 */
export function ModalThreadsDrawer({
  threadsDrawer,
}: {
  threadsDrawer: Exclude<ModalThreadsDrawerProp, false>;
}) {
  // The header shows its launcher once a drawer registers. Register here, so a
  // replacement drawer gets the launcher without registering itself.
  const registerDrawer = useCopilotChatConfiguration()?.registerDrawer;
  useEffect(() => registerDrawer?.(), [registerDrawer]);

  return (
    <Suspense fallback={null}>
      {renderSlot(
        threadsDrawer === true ? undefined : threadsDrawer,
        LazyCopilotThreadsDrawer,
        {},
      )}
    </Suspense>
  );
}

/**
 * Gives a modal's chat and its threads drawer a chat configuration to switch
 * threads through. An app that already provides one keeps it; without one,
 * a thread picked in the drawer would never reach the chat.
 *
 * `threadId` is the modal's own `threadId` prop. The scope owns the thread the
 * chat falls back to, so it follows the prop: clearing it starts a fresh
 * thread, as it does without the drawer.
 */
export function ModalThreadsScope({
  enabled,
  threadId,
  children,
}: {
  enabled: boolean;
  threadId?: string;
  children: React.ReactNode;
}) {
  const parentConfig = useCopilotChatConfiguration();
  if (!enabled || parentConfig) return <>{children}</>;
  return (
    <CopilotChatConfigurationProvider threadId={threadId}>
      {children}
    </CopilotChatConfigurationProvider>
  );
}
