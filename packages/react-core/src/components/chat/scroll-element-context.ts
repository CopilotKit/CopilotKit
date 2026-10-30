import React from "react";

/**
 * Provides the scroll container element to child components that need it for
 * virtualization. Set by CopilotChatView.ScrollView; consumed by
 * CopilotChatMessageView to feed useVirtualizer's getScrollElement.
 *
 * Carries the element itself (not a ref) so that context consumers re-render
 * reactively when the scroll container is first mounted.
 */
export const ScrollElementContext = React.createContext<HTMLElement | null>(
  null,
);
