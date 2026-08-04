"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CopilotSidebar,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";
import type { CopilotSidebarProps } from "@copilotkit/react-core/v2";

import { useSkin } from "@/shell/skin-provider";
import { ChatPanelHeader } from "./chat-panel-header";
import { ChatInbox } from "./chat-inbox";
import { useChatInbox } from "./chat-inbox-context";
import { DemoSuggestionsView } from "./demo-suggestions";

/** Conversation column width on desktop (px). Mobile falls back to full width.
 * Sized so the always-on suggestion pills flow two-per-row instead of
 * stacking into a single tall column. */
const PANEL_WIDTH = 480;
/** Deliberately narrower than ChatGPT's own ~260px sidebar: here the rail is
 * one of THREE columns competing with the banking app for width, and thread
 * titles are short. 200px still fits "Over-Limit Pending Charges…" truncated
 * without the rail dominating the viewport. */
const RAIL_WIDTH = 200;

/**
 * The docked chat experience, arranged like ChatGPT and docked to the LEFT:
 *
 *   [ thread rail 260 ][ conversation 480 ][ the banking app ]
 *
 * `CopilotSidebar` renders a `position="left"` fixed `<aside>` pinned to
 * `left: 0` whose width comes from the `width` prop, and it pushes page content
 * over by setting `document.body`'s `margin-inline-start` to that same width.
 * So we hand it the width of BOTH columns (rail + conversation) and then inset
 * its own contents past the rail with `--nw-rail-offset` (see the
 * `[data-copilot-sidebar][data-position="left"]` rule in globals.css). The rail
 * itself paints into the strip that inset frees up, as a sibling fixed at
 * `left: 0`. Net effect: the thread list sits to the LEFT of the conversation
 * (ChatGPT's arrangement) and the app starts after both.
 *
 * Collapsing the rail (header toggle) drops the sidebar back to just the
 * conversation width, so the app reclaims that 260px instead of leaving a gap.
 *
 * Why `CopilotSidebar` directly (no license bypass): the OSS demo ships no
 * license token, so `CopilotKitProvider` wires `createLicenseContextValue(null)`
 * whose `checkFeature` returns `true` for every feature. `CopilotSidebar`'s
 * `checkFeature("sidebar")` therefore passes — no `InlineFeatureWarning` banner
 * and no console warning.
 *
 * `threadId` is threaded through to `CopilotSidebar` (which forwards it to the
 * underlying `CopilotChat`) so frontend-tool round-trips keep their thread
 * anchor. The wrapper-level `CopilotChatConfigurationProvider` already supplies
 * `hasExplicitThreadId`, which flows down to the chat.
 */
export function ChatPanel({ threadId }: { threadId: string }) {
  const skin = useSkin();
  const [showArchived, setShowArchived] = useState(false);

  // Read the panel's open state from the configuration chain. The wrapper's
  // provider stays in sync with the sidebar's internal modal state (open/close
  // propagates upward), so this reflects whether the panel is currently docked.
  const configuration = useCopilotChatConfiguration();
  const panelOpen = configuration?.isModalOpen ?? false;

  const { isInboxOpen } = useChatInbox();
  const railVisible = isInboxOpen && panelOpen;

  // Publish the chat's docked geometry as CSS custom properties on the root, so
  // shell chrome can react to it without a className on the SDK-owned `<aside>`
  // (CopilotSidebarView creates it and takes no consumer className).
  //
  //  --nw-rail-offset : inset the sidebar's own chrome past the thread rail.
  //  --nw-chat-width  : the width the docked panel steals from the page — 0 when
  //                     closed (it collapses to a launcher and reserves no
  //                     width), PANEL_WIDTH when open, +RAIL_WIDTH with the rail.
  //                     The floating skin selector consumes this to sit clear of
  //                     the left-docked chat in every skin (see globals.css
  //                     `.nw-selector-dock`) without importing the chat's dims.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--nw-rail-offset",
      railVisible ? `${RAIL_WIDTH}px` : "0px",
    );
    const dockedWidth = panelOpen
      ? railVisible
        ? RAIL_WIDTH + PANEL_WIDTH
        : PANEL_WIDTH
      : 0;
    root.style.setProperty("--nw-chat-width", `${dockedWidth}px`);
    // Also expose the open state as a data attribute. On mobile the chat is a
    // full-screen overlay that reserves no width (so --nw-chat-width can't tell
    // the selector dock to hide); the dock keys its mobile hide off this flag so
    // the pill never lands over the open overlay's composer (see globals.css).
    root.dataset.nwChatOpen = panelOpen ? "true" : "false";
    return () => {
      root.style.removeProperty("--nw-rail-offset");
      root.style.removeProperty("--nw-chat-width");
      delete root.dataset.nwChatOpen;
    };
  }, [railVisible, panelOpen]);

  // Start the docked panel OPEN so the copilot (and its suggestion bubbles) is
  // front-and-center the moment the app loads. Force it once on mount via the
  // configuration setter (the provider chain's default can be inconsistent); a
  // ref guard keeps it one-time so the user can still close it freely after.
  const setModalOpen = configuration?.setModalOpen;
  const didInitRef = useRef(false);
  useLayoutEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    setModalOpen?.(true);
  }, [setModalOpen]);

  return (
    <>
      <CopilotSidebar
        agentId={skin.id}
        threadId={threadId}
        position="left"
        width={railVisible ? RAIL_WIDTH + PANEL_WIDTH : PANEL_WIDTH}
        defaultOpen={true}
        // The `header` slot is typed as `SlotValue<typeof CopilotModalHeader>`,
        // which expects a component carrying CopilotModalHeader's namespace
        // statics (Title/CloseButton). A plain replacement component does not
        // structurally match that, so we cast — the same pattern CopilotKit's
        // own slot tests use for custom headers. `renderSlot` renders any
        // component reference at runtime.
        header={ChatPanelHeader as CopilotSidebarProps["header"]}
        // Custom suggestion pills: the eight registered via
        // useConfigureSuggestions, but this slot owns the empty-state layout and
        // routes each click through the active skin first (skin.onSuggestionSelect).
        // Banking intercepts ONLY the Q2-report pill, which rides a real PDF
        // attachment so the model reads the invoice; every other pill — the
        // change-PIN pill included — takes the framework's normal send path (the
        // PIN request renders the in-chat PIN card via the agent, not a separate
        // app dialog). See demo-suggestions.tsx.
        suggestionView={
          DemoSuggestionsView as CopilotSidebarProps["suggestionView"]
        }
        // Multimodal attachments: officers can drop a PDF (e.g. a vendor
        // invoice) or an image into the composer. With no custom onUpload the
        // built-in handler base64-encodes the file and sends it as a document
        // part on the message, so gpt-5.4 can read it — e.g. "prep the Q2
        // report" then augments the report with the uploaded invoice's figures.
        attachments={{
          enabled: true,
          accept: "application/pdf,image/*",
          maxSize: 20 * 1024 * 1024,
        }}
        // Drop the "AI can make mistakes…" line under the composer. A plain
        // object in a slot position is treated as a props override by
        // renderSlot, so this reaches CopilotChatInput's own showDisclaimer.
        input={{ showDisclaimer: false }}
        labels={{
          modalHeaderTitle: skin.identity.assistantName ?? skin.identity.brand,
          welcomeMessageText: skin.identity.greeting ?? skin.identity.tagline,
        }}
      />
      <ChatInbox
        panelOpen={panelOpen}
        showArchived={showArchived}
        onShowArchivedChange={setShowArchived}
        width={RAIL_WIDTH}
      />
    </>
  );
}

export default ChatPanel;
