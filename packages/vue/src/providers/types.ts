import type { CopilotChatLabels } from "@copilotkit/core";

export { CopilotChatDefaultLabels } from "@copilotkit/core";
export type { CopilotChatLabels } from "@copilotkit/core";

export interface CopilotChatConfigurationValue {
  labels: CopilotChatLabels;
  agentId: string;
  threadId: string;
  /**
   * True when the current `threadId` was chosen by the caller rather than
   * silently minted inside the provider chain. Consumers that only make
   * sense against a real backend thread (e.g. `/connect`, suppressing the
   * welcome screen on switch) gate on this instead of `!!threadId`.
   */
  hasExplicitThreadId: boolean;
  isModalOpen?: boolean;
  setModalOpen?: (open: boolean) => void;
  /**
   * Switches the active thread to `threadId`. `explicit` (default `true`)
   * marks it a caller-driven choice so the welcome screen is suppressed.
   * No-op when the provider's `threadId` prop is caller-authoritative.
   */
  setActiveThreadId: (
    threadId: string,
    options?: { explicit?: boolean },
  ) => void;
  /**
   * Switches to a freshly-minted, non-explicit thread (welcome screen shows).
   * No-op when the provider's `threadId` prop is caller-authoritative.
   */
  startNewThread: () => void;
  /** Whether the mobile off-canvas drawer overlay is open. */
  drawerOpen: boolean;
  /**
   * Toggles the drawer. On mobile (`<=767px`) opening the drawer closes the
   * chat modal (mutual-exclusion). Desktop imposes no constraint.
   */
  setDrawerOpen: (open: boolean) => void;
  /** True when at least one drawer has registered (gates the header launcher). */
  drawerRegistered: boolean;
  /** Announces drawer presence; returns a cleanup that de-registers it. */
  registerDrawer: () => () => void;
}
