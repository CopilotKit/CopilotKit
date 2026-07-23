"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  CopilotSidebar,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";
import type { CopilotSidebarProps } from "@copilotkit/react-core/v2";

import { IDENTITY } from "@/lib/identity";
import { ChatPanelHeader } from "./chat-panel-header";
import { ChatInbox } from "./chat-inbox";

/** Docked panel width on desktop (px). Mobile falls back to full width.
 * Sized so the always-on suggestion pills flow two-per-row instead of
 * stacking into a single tall column. */
const PANEL_WIDTH = 560;

/**
 * The docked chat experience: a right-side `CopilotSidebar` that pushes page
 * content aside (CopilotSidebarView manages the body margin) plus an
 * inbox-style conversation list that paints over the chat area.
 *
 * Why `CopilotSidebar` directly (no license bypass): the OSS demo ships no
 * license token, so `CopilotKitProvider` wires `createLicenseContextValue(null)`
 * whose `checkFeature` returns `true` for every feature. `CopilotSidebar`'s
 * `checkFeature("sidebar")` therefore passes — no `InlineFeatureWarning` banner
 * and no console warning. Verified visually as well.
 *
 * `threadId` is threaded through to `CopilotSidebar` (which forwards it to the
 * underlying `CopilotChat`) so frontend-tool round-trips keep their thread
 * anchor. The wrapper-level `CopilotChatConfigurationProvider` already supplies
 * `hasExplicitThreadId`, which flows down to the chat.
 */
export function ChatPanel({ threadId }: { threadId: string }) {
  const [showArchived, setShowArchived] = useState(false);

  // Read the panel's open state from the configuration chain. The wrapper's
  // provider stays in sync with the sidebar's internal modal state (open/close
  // propagates upward), so this reflects whether the panel is currently docked.
  const configuration = useCopilotChatConfiguration();
  const panelOpen = configuration?.isModalOpen ?? false;

  // Start the docked panel CLOSED for a clean dashboard first impression.
  //
  // `CopilotSidebar` accepts `defaultOpen={false}`, but it cannot win here: the
  // v1 `CopilotKit` bridge (this app uses the v1 export) mounts its own
  // top-level `CopilotChatConfigurationProvider` with `isModalDefaultOpen`
  // hard-commented-out, so it defaults the modal OPEN (true) and that value
  // cascades DOWN through every nested chat provider via their parent→child
  // sync. There is no bridge prop to change that default, so we correct it once
  // on mount. `ChatPanel` reads the wrapper-level provider, which has no
  // explicit default and therefore delegates its setter to the bridge — so this
  // one call flips the root closed and the change cascades to the sidebar. A ref
  // guard makes it a one-time action; the floating toggle still opens the panel
  // freely afterward, and `useLayoutEffect` runs before paint so it never
  // flashes open.
  const setModalOpen = configuration?.setModalOpen;
  const didCloseRef = useRef(false);
  useLayoutEffect(() => {
    if (didCloseRef.current) return;
    didCloseRef.current = true;
    setModalOpen?.(false);
  }, [setModalOpen]);

  return (
    <>
      <CopilotSidebar
        agentId="default"
        threadId={threadId}
        position="right"
        width={PANEL_WIDTH}
        defaultOpen={false}
        // The `header` slot is typed as `SlotValue<typeof CopilotModalHeader>`,
        // which expects a component carrying CopilotModalHeader's namespace
        // statics (Title/CloseButton). A plain replacement component does not
        // structurally match that, so we cast — the same pattern CopilotKit's
        // own slot tests use for custom headers. `renderSlot` renders any
        // component reference at runtime.
        header={ChatPanelHeader as CopilotSidebarProps["header"]}
        labels={{
          modalHeaderTitle: IDENTITY.assistant,
          welcomeMessageText: IDENTITY.greeting,
        }}
      />
      <ChatInbox
        panelOpen={panelOpen}
        showArchived={showArchived}
        onShowArchivedChange={setShowArchived}
        width={PANEL_WIDTH}
      />
    </>
  );
}

export default ChatPanel;
