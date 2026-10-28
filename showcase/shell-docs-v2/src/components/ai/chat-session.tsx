"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
} from "@copilotkit/react-core/v2";
import { DocsGuideTools } from "./guide-tools";
import { DocsToolStatuses, SIDE_BY_SIDE } from "./docs-agent";
import { OnboardingGuideContext } from "./onboarding-guide";

const ChatSessionContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  followLink: () => void;
} | null>(null);

export const useDocsChatSession = () => useContext(ChatSessionContext);

/** Lives above the home/docs layout switch, so internal links keep the agent. */
export function DocsChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(
    () => ({
      open,
      setOpen,
      followLink: () => setOpen(window.matchMedia(SIDE_BY_SIDE).matches),
    }),
    [open],
  );

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint
      enableInspector={false}
    >
      <ChatSessionContext value={value}>
        <CopilotChatConfigurationProvider>
          <DocsGuideTools />
          <OnboardingGuideContext />
          <DocsToolStatuses />
          {children}
        </CopilotChatConfigurationProvider>
      </ChatSessionContext>
    </CopilotKitProvider>
  );
}
