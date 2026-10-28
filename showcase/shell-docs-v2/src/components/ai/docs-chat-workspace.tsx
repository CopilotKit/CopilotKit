"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  hasOnboardingGuide,
  OnboardingGuide,
  useOnboardingGuide,
} from "./onboarding-guide";

const WIDE_HOME = "(min-width: 64rem)";
function subscribeToWidth(callback: () => void) {
  const query = window.matchMedia(WIDE_HOME);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const wideSnapshot = () => window.matchMedia(WIDE_HOME).matches;
const serverSnapshot = () => false;

/** One mounted chat, with a running guide alongside it or in a compact tab. */
export function DocsChatWorkspace({
  home = false,
  children,
}: {
  home?: boolean;
  children: ReactNode;
}) {
  const configuration = useCopilotChatConfiguration();
  return (
    <Workspace threadId={configuration?.threadId} home={home}>
      {children}
    </Workspace>
  );
}

function Workspace({
  home,
  children,
  threadId,
}: {
  home: boolean;
  children: ReactNode;
  threadId?: string;
}) {
  const guide = useOnboardingGuide();
  const hasGuide = hasOnboardingGuide(guide);
  const wide = useSyncExternalStore(
    subscribeToWidth,
    wideSnapshot,
    serverSnapshot,
  );
  const split = home && wide && hasGuide;
  const [selection, setSelection] = useState<{
    threadId?: string;
    tab: "chat" | "guide";
  }>({ threadId, tab: "chat" });
  const activeTab =
    hasGuide && selection.threadId === threadId ? selection.tab : "chat";

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) =>
        setSelection({ threadId, tab: value === "guide" ? "guide" : "chat" })
      }
      className="min-h-0 flex-1 gap-0"
    >
      {hasGuide && !split ? (
        <TabsList
          variant="line"
          aria-label="Conversation and onboarding guide"
          className="min-h-12 w-full shrink-0 border-b border-fd-border px-2"
        >
          <TabsTrigger value="chat" className="min-h-11">
            Chat
          </TabsTrigger>
          <TabsTrigger value="guide" className="min-h-11">
            Your guide
          </TabsTrigger>
        </TabsList>
      ) : null}
      <div
        className={cn(
          "flex min-h-0 flex-1",
          split && "grid grid-cols-[minmax(0,1fr)_22rem]",
        )}
      >
        <TabsContent
          value="chat"
          keepMounted
          hidden={!split && activeTab !== "chat"}
          inert={!split && activeTab !== "chat"}
          role={split || !hasGuide ? "region" : "tabpanel"}
          aria-label="Chat"
          className="flex min-h-0 min-w-0 flex-1 flex-col [&[hidden]]:hidden"
        >
          {children}
        </TabsContent>
        {hasGuide ? (
          <TabsContent
            value="guide"
            keepMounted
            hidden={!split && activeTab !== "guide"}
            inert={!split && activeTab !== "guide"}
            role={split ? "region" : "tabpanel"}
            aria-label="Your guide"
            className={cn(
              "min-h-0 min-w-0 flex-1 [&[hidden]]:hidden",
              split && "border-l border-fd-border",
            )}
          >
            <OnboardingGuide guide={guide} />
          </TabsContent>
        ) : null}
      </div>
    </Tabs>
  );
}
