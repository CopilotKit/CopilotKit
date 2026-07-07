"use client";

import { useState } from "react";
import { useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGlassEngine } from "@/components/glass-engine-context";
import { useInspector } from "@/lib/inspector/store";
import { useInspectorEvents } from "./use-inspector-events";
import { TimelineTab } from "./timeline-tab";
import { MemoryTab } from "./memory-tab";
import { LearningTab } from "./learning-tab";

/** Matches CopilotSidebar's docked width (chat-panel.tsx PANEL_WIDTH = 440). */
const CHAT_WIDTH = 440;

export function InspectorPane() {
  // Tap the live AG-UI stream regardless of which tab is open. Runs whenever the
  // pane is mounted (Task 12 mounts it only when the deployment opted in), so the
  // Timeline accumulates history even while the pane is collapsed.
  useInspectorEvents();
  const { active, setEnabled } = useGlassEngine();
  const { clear } = useInspector();
  const [tab, setTab] = useState("timeline");

  // Slide in next to the chat: anchored to the chat's right-dock width when the
  // chat is open, flush to the edge when it's closed.
  const chatOpen = useCopilotChatConfiguration()?.isModalOpen ?? false;

  if (!active) return null;

  return (
    <aside
      // Desktop-only (mirrors CopilotSidebar's body-margin desktop gate). Fixed
      // so it's independent of the body margin CopilotSidebar manages.
      className="glass-surface fixed inset-y-0 z-30 hidden w-96 flex-col border-l border-hairline shadow-lift transition-[right] duration-300 md:flex"
      style={{ right: chatOpen ? CHAT_WIDTH : 0 }}
    >
      <header className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <h2 className="text-xs font-semibold text-ink">
          Glass Engine — live protocol inspector
        </h2>
        <button
          onClick={clear}
          className="ml-auto text-[10px] text-ink-muted hover:text-ink"
        >
          clear
        </button>
        <button
          onClick={() => setEnabled(false)}
          className="text-[10px] text-ink-muted hover:text-ink"
        >
          collapse →
        </button>
      </header>
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList variant="underline" className="shrink-0 px-3 pt-2">
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="learning">Learning</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="timeline">
            <TimelineTab />
          </TabsContent>
          <TabsContent value="memory">
            <MemoryTab />
          </TabsContent>
          <TabsContent value="learning">
            <LearningTab />
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}
