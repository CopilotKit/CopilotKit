import React from "react";

/**
 * Provides the scroll container element to child components that need it for
 * virtualization. Set by CopilotChatView.ScrollView; consumed by
 * CopilotChatMessageView to feed useVirtualizer's getScrollElement.
 */
export const ScrollElementRefContext =
  React.createContext<React.RefObject<HTMLElement | null> | null>(null);
