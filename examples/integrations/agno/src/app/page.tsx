"use client";

import {
  useDefaultRenderTool,
  useFrontendTool,
  useRenderTool,
  CopilotSidebar,
  CopilotChatConfigurationProvider,
} from "@copilotkit/react-core/v2";
import React, { useState } from "react";
import { z } from "zod";
import { DefaultToolComponent } from "@/components/default-tool-ui";
import { WeatherCard } from "@/components/weather";
import { ThreadsDrawer } from "@/components/threads-drawer";
import { ThreadsPanelGate } from "@/components/threads-drawer/locked-state";
import styles from "@/components/threads-drawer/threads-drawer.module.css";

// agno registers a single agent under the key "agno_agent" (see
// src/app/api/copilotkit/[[...slug]]/route.ts) and CopilotKit is mounted with
// agent="agno_agent" in layout.tsx, so the threads drawer + chat config provider
// must address that same agent id.
const AGENT_ID = "agno_agent";

export default function CopilotKitPage() {
  const [themeColor, setThemeColor] = useState("#6366f1");
  const [threadId, setThreadId] = useState<string | undefined>(undefined);

  // 🪁 Frontend Actions: https://docs.copilotkit.ai/guides/frontend-actions
  useFrontendTool({
    name: "set_theme_color",
    parameters: z.object({
      theme_color: z
        .string()
        .describe("The theme color to set. Make sure to pick nice colors."),
    }),
    handler({ theme_color }) {
      setThemeColor(theme_color);
    },
  });

  return (
    <div className={styles.layout}>
      {/* Bespoke threads panel, themed in globals.css to match agno's chat. */}
      <ThreadsPanelGate>
        <ThreadsDrawer
          agentId={AGENT_ID}
          threadId={threadId}
          onThreadChange={setThreadId}
        />
      </ThreadsPanelGate>
      {/*
        Share the active threadId between the threads drawer and the chat. The
        CopilotSidebar's chat falls back to this provider's threadId when none is
        passed explicitly, so selecting a thread in the drawer resumes it in the
        chat.
      */}
      <CopilotChatConfigurationProvider agentId={AGENT_ID} threadId={threadId}>
        <main
          className={styles.mainPanel}
          style={
            { "--copilot-kit-primary-color": themeColor } as React.CSSProperties
          }
        >
          <YourMainContent themeColor={themeColor} />
          <CopilotSidebar
            defaultOpen={true}
            // Adds an initial message to the chat
            labels={{
              title: "Popup Assistant",
              initial: "👋 Hi, there! You're chatting with an Agno agent.",
            }}
            // Suggestions for guiding users
            suggestions={[
              {
                title: "Generative UI",
                message: "What's the weather in San Francisco?",
              },
              {
                title: "Frontend Tools",
                message: "Set the theme to green.",
              },
              {
                title: "Default Tool Rendering",
                message: "What's the latest price of Apple stock?",
              },
              {
                title: "Writing Agent State",
                message: "Add a proverb about AI.",
              },
            ]}
          />
          {/* CopilotSidebar self-docks; main content renders as a sibling. */}
        </main>
      </CopilotChatConfigurationProvider>
    </div>
  );
}

function YourMainContent({ themeColor }: { themeColor: string }) {
  const [state, setState] = useState<{ proverbs: string[] }>({
    proverbs: [
      "CopilotKit may be new, but its the best thing since sliced bread.",
    ],
  });

  // 🪁 Frontend Actions: https://docs.copilotkit.ai/agno/frontend-tools
  useFrontendTool({
    name: "add_proverb",
    parameters: z.object({
      proverb: z
        .string()
        .describe("The proverb to add. Make it witty, short and concise."),
    }),
    handler: ({ proverb }) => {
      setState({
        ...state,
        proverbs: [...state.proverbs, proverb],
      });
    },
  });

  //🪁 Generative UI: https://docs.copilotkit.ai/agno/generative-ui/backend-tools
  useRenderTool(
    {
      name: "get_weather",
      render: (props) => <WeatherCard themeColor={themeColor} {...props} />,
    },
    [themeColor],
  );

  //🪁 Default Generative UI: https://docs.copilotkit.ai/agno/generative-ui/backend-tools
  useDefaultRenderTool(
    {
      render: (props) => (
        <DefaultToolComponent themeColor={themeColor} {...props} />
      ),
    },
    [themeColor],
  );

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
          {state.proverbs?.map((proverb, index) => (
            <div
              key={index}
              className="bg-white/15 p-4 rounded-xl text-white relative group hover:bg-white/20 transition-all"
            >
              <p className="pr-8">{proverb}</p>
              <button
                onClick={() =>
                  setState({
                    ...state,
                    proverbs: state.proverbs?.filter((_, i) => i !== index),
                  })
                }
                className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity
                  bg-red-500 hover:bg-red-600 text-white rounded-full h-6 w-6 flex items-center justify-center"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        {state.proverbs?.length === 0 && (
          <p className="text-center text-white/80 italic my-8">
            No proverbs yet. Ask the assistant to add some!
          </p>
        )}
      </div>
    </div>
  );
}
