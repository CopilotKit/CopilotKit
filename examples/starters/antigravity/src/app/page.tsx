"use client";

import { MeetingTimePicker } from "@/components/generative-ui/meeting-time-picker";
import { WeatherCard } from "@/components/weather";
import { AGENT_ID } from "@/agent";
import {
  CopilotSidebar,
  useConfigureSuggestions,
  useFrontendTool,
  useHumanInTheLoop,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import React, { useState } from "react";
import { z } from "zod";

/**
 * What this page demonstrates, and what it deliberately does not.
 *
 * Antigravity keeps the conversation inside its Go harness process, keyed by
 * thread. It does not expose shared agent state to the client yet — there is
 * no STATE_DELTA and no writable state — so there is no `useAgent().setState`
 * demo here. What it does support, and what this page shows, is the tool
 * surface in all three directions:
 *
 *   1. a FRONTEND tool the agent calls in the browser (`setThemeColor`),
 *   2. a BACKEND tool the agent runs in Python, rendered here (`get_weather`),
 *   3. a HUMAN-IN-THE-LOOP tool that parks the run until you answer
 *      (`scheduleTime`).
 */
export default function CopilotKitPage() {
  const [themeColor, setThemeColor] = useState("#6366f1");

  // 1. Frontend tool — runs in the browser. The agent calls it like any other
  // tool; the handler's return value is what the model sees as the result.
  useFrontendTool({
    name: "setThemeColor",
    description:
      "Repaint the page background. Also known as changing the theme or background color.",
    parameters: z.object({
      themeColor: z
        .string()
        .describe("A CSS color, e.g. #6366f1. Pick something pleasant."),
    }),
    handler: async ({ themeColor: next }) => {
      setThemeColor(next);
      return `Background is now ${next}.`;
    },
  });

  // 2. Backend tool rendering — `get_weather` lives in agent/main.py and runs
  // in the Python process. The adapter streams the call and its result here,
  // and this renderer draws the card. Nothing executes in the browser.
  useRenderTool({
    name: "get_weather",
    parameters: z.object({ location: z.string() }),
    render: ({ parameters }) => (
      <WeatherCard location={parameters.location} themeColor={themeColor} />
    ),
  });

  // 3. Human-in-the-loop — the agent calls this tool and the Antigravity run
  // PARKS on the awaited coroutine until `respond()` is called. The picker's
  // answer becomes the tool's return value, so the agent continues with what
  // the user actually chose.
  useHumanInTheLoop<{ reasonForScheduling: string; meetingDuration: number }>({
    name: "scheduleTime",
    description:
      "Ask the user to pick a meeting slot. Returns the slot they chose.",
    parameters: z.object({
      reasonForScheduling: z
        .string()
        .describe("Why the meeting is happening. Very brief — 5 words."),
      meetingDuration: z.number().describe("Meeting length in minutes."),
    }),
    render: ({ status, respond, args }) => (
      <MeetingTimePicker status={status} respond={respond} {...args} />
    ),
  });

  useConfigureSuggestions({
    suggestions: [
      { title: "Frontend tool", message: "Make the background sea green." },
      {
        title: "Backend tool",
        message: "What's the weather in San Francisco?",
      },
      { title: "Human in the loop", message: "Book me an onboarding call." },
    ],
  });

  return (
    <main
      style={
        {
          "--copilot-kit-primary-color": themeColor,
        } as React.CSSProperties
      }
    >
      <div
        style={{ backgroundColor: themeColor }}
        className="h-screen flex justify-center items-center flex-col gap-4 transition-colors duration-300"
      >
        <div className="max-w-md rounded-xl bg-white/20 p-6 text-white backdrop-blur-sm">
          <h1 className="text-2xl font-bold">
            CopilotKit × Google Antigravity
          </h1>
          <p className="mt-2 text-sm text-white/90">
            Ask the assistant to change this background, look up the weather, or
            book a call. Each one exercises a different tool direction —
            browser, Python, and a run that waits for you.
          </p>
        </div>
      </div>
      <CopilotSidebar
        agentId={AGENT_ID}
        defaultOpen={true}
        labels={{
          modalHeaderTitle: "Popup Assistant",
          welcomeMessageText:
            "👋 Hi there! You're chatting with an Antigravity agent.",
        }}
      />
    </main>
  );
}
