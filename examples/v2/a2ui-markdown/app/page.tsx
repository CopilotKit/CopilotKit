"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { Providers } from "./providers";
import type { ExampleAgent } from "./providers";

/**
 * Click-to-try prompts. Each one leans on a different part of the standard
 * catalog so the pills double as a quick tour: inputs and bindings, tables,
 * charts, forms, maps, and flip cards.
 */
const SUGGESTIONS = [
  {
    title: "Team plan estimator",
    message:
      "Build me an interactive team plan estimator: a slider for number of seats (1-50) at $29 per seat showing the monthly price, a checkbox for annual billing with 20% discount, a small comparison table of Starter/Team/Enterprise, and a form with name and email plus a Request quote button.",
  },
  {
    title: "Compare laptops",
    message:
      "Compare three laptops for video editing in a table (price, CPU, RAM, screen, battery). Mark the best value with a badge and add a button under each one that tells you which I picked.",
  },
  {
    title: "Trip budget chart",
    message:
      "Plan a 5-day trip to Lisbon: a day-by-day itinerary list, and a bar chart of the estimated daily budget split into food, transport and activities.",
  },
  {
    title: "Workout planner",
    message:
      "Build a weekly workout planner: a select for my goal (strength, endurance, mobility), a radio group for days per week, a slider for minutes per session, and a Create plan button that sends my choices back to you.",
  },
  {
    title: "Cafés on a map",
    message:
      "Show four famous coffee houses in Vienna on a map with markers, and a short list underneath with one line about each.",
  },
  {
    title: "Spanish flashcards",
    message:
      "Make me five flashcards to learn Spanish greetings. Show them as flip cards in a grid and add a button that asks you for five more.",
  },
];

function Suggestions({ agent }: { agent: ExampleAgent }) {
  useConfigureSuggestions(
    { suggestions: SUGGESTIONS, available: "always", consumerAgentId: agent },
    [agent],
  );
  return null;
}

function Chat() {
  const searchParams = useSearchParams();
  const agent: ExampleAgent =
    searchParams.get("agent") === "langgraph" ? "langgraph" : "default";

  return (
    <Providers agent={agent}>
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100dvh",
          maxWidth: 880,
          margin: "0 auto",
          padding: "0 16px",
        }}
      >
        <header style={{ padding: "16px 0 8px" }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>
            A2UI markdown mode (
            {agent === "langgraph" ? "LangGraph Python" : "built-in agent"})
          </h1>
          <p style={{ fontSize: 14, margin: "4px 0 0", opacity: 0.7 }}>
            Click a suggestion below the chat to try the standard catalog.
          </p>
        </header>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Suggestions agent={agent} />
          <CopilotChat />
        </div>
      </main>
    </Providers>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Chat />
    </Suspense>
  );
}
