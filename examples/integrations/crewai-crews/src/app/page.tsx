"use client";

import {
  useAgent,
  CopilotSidebar,
  CopilotChatConfigurationProvider,
} from "@copilotkit/react-core/v2";
import type { CSSProperties } from "react";
import { useState } from "react";

import { ThreadsDrawer } from "@/components/threads-drawer";
import { ThreadsPanelGate } from "@/components/threads-drawer/locked-state";
import styles from "@/components/threads-drawer/threads-drawer.module.css";

const agentId = "starterAgent";

export default function CopilotKitPage() {
  const [themeColor] = useState("#6366f1");
  const [threadId, setThreadId] = useState<string | undefined>(undefined);

  return (
    <div className={`${styles.layout} threadsLayout`}>
      <ThreadsPanelGate>
        <ThreadsDrawer
          agentId={agentId}
          threadId={threadId}
          onThreadChange={setThreadId}
        />
      </ThreadsPanelGate>
      <div className={styles.mainPanel}>
        <CopilotChatConfigurationProvider agentId={agentId} threadId={threadId}>
          <main
            style={
              {
                "--copilot-kit-primary-color": themeColor,
              } as CSSProperties
            }
          >
            <YourMainContent themeColor={themeColor} />
            <CopilotSidebar
              defaultOpen={true}
              labels={{
                welcomeMessageText:
                  '👋 Hi, there! You\'re chatting with an agent. This agent comes with a few tools to get you started.\n\nFor example you can try:\n- **Frontend Tools**: "Set the theme to orange"\n- **Shared State**: "Write a proverb about AI"\n- **Generative UI**: "Get the weather in SF"\n\nAs you interact with the agent, you\'ll see the UI update in real-time to reflect the agent\'s **state**, **tool calls**, and **progress**.',
              }}
            />
          </main>
        </CopilotChatConfigurationProvider>
      </div>
    </div>
  );
}

function YourMainContent({ themeColor }: { themeColor: string }) {
  const { agent } = useAgent({
    agentId,
  });

  return (
    <div
      style={{ backgroundColor: themeColor }}
      className="h-screen flex justify-center items-center flex-col transition-colors duration-300"
    >
      <div className="bg-white/20 backdrop-blur-md p-8 rounded-2xl shadow-xl max-w-2xl w-full">
        <h1 className="text-4xl font-bold text-white mb-2 text-center">
          Proverbs
        </h1>
        <p className="text-gray-200 text-center italic mb-6">
          This is a demonstrative page, but it could be anything you want! 🪁
        </p>
        <hr className="border-white/20 my-6" />
        <div className="flex flex-col gap-3">
          {agent.state?.proverbs?.map((proverb: string, index: number) => (
            <div
              key={index}
              className="bg-white/15 p-4 rounded-xl text-white relative group hover:bg-white/20 transition-all"
            >
              <p className="pr-8">{proverb}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
