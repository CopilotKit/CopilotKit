"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { GenerativeUISurface } from "@copilotkit/react-core/v2/generative-ui";
import Link from "next/link";
import { Providers } from "./providers";
import type { ExampleAgent, ExampleTransport } from "./providers";

/**
 * Click-to-try prompts. Each one leans on a different part of the standard
 * components so the pills double as a quick tour: inputs and bindings, tables,
 * charts, forms, maps, and flip cards.
 */
const SUGGESTIONS = [
  {
    title: "Dashboard on the page",
    message:
      'Show a sales dashboard in the "dashboard" surface on the page, not in the chat: three stat cards (revenue, orders, average order value), a line chart of revenue over the last 6 months, and a table of the top 5 products.',
  },
  {
    title: "Checklist in the notes",
    message:
      'Put a launch checklist in the "notes" surface on the page, not in the chat: a title and five checkboxes for the launch steps.',
  },
  {
    title: "Update the dashboard",
    message:
      'Change the dashboard on the page: replace the line chart with a bar chart of orders per month, and add a badge "Best month" to the top month. Update the same surface; do not make a new one.',
  },
  {
    title: "Team plan estimator",
    message:
      "Build me an interactive team plan estimator: a slider for number of seats (1-50) at $29 per seat showing the monthly price, a checkbox for annual billing with 20% discount, a small comparison table of Starter/Team/Enterprise, a bar chart of the cumulative cost over 12 months, and a form with name and email plus a Request quote button.",
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

/** Shown in a page surface until the agent renders into it. */
function EmptySurface({ label }: { label: string }) {
  return (
    <div
      style={{
        border: "1px dashed #c7c7cc",
        borderRadius: 12,
        padding: 16,
        fontSize: 13,
        opacity: 0.7,
      }}
    >
      {label}
    </div>
  );
}

/**
 * Two named surfaces outside the chat. The model learns their ids and
 * descriptions from the manifest, and renders into them with a target.
 */
function PageSurfaces() {
  return (
    <section className="example-page" aria-label="Page surfaces">
      <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>
        On the page (outside the chat)
      </h2>
      <GenerativeUISurface
        id="dashboard"
        description="The main panel of the page, to the left of the chat. Use it for dashboards, charts, and tables that the user asks to show on the page."
        fallback={
          <EmptySurface label='The "dashboard" surface is empty. Try the "Dashboard on the page" suggestion.' />
        }
      />
      <h2 style={{ fontSize: 14, margin: "16px 0 8px" }}>Notes</h2>
      <GenerativeUISurface
        id="notes"
        description="A small card under the dashboard. Use it for short notes, checklists, and summaries that the user asks to keep on the page."
        fallback={
          <EmptySurface label='The "notes" surface is empty. Try the "Checklist in the notes" suggestion.' />
        }
      />
    </section>
  );
}

/** Page and chat side by side; stacked on a narrow screen. */
const LAYOUT_CSS = `
.example-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,440px);gap:16px;flex:1;min-height:0}
.example-page{overflow:auto;min-height:0;padding-bottom:16px}
.example-chat{min-height:0;display:flex;flex-direction:column}
@media (max-width: 900px){.example-layout{grid-template-columns:1fr;grid-template-rows:auto minmax(480px,1fr)}.example-page{overflow:visible}}
`;

function Chat() {
  const searchParams = useSearchParams();
  const agent: ExampleAgent =
    searchParams.get("agent") === "langgraph" ? "langgraph" : "default";
  const transport: ExampleTransport =
    searchParams.get("transport") === "tool" ? "tool" : "markdown";
  const href = (a: ExampleAgent, t: ExampleTransport) =>
    `/?agent=${a}&transport=${t}`;

  return (
    <Providers agent={agent} transport={transport}>
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100dvh",
          maxWidth: 1320,
          margin: "0 auto",
          padding: "0 16px",
        }}
      >
        <header style={{ padding: "16px 0 8px" }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>
            Generative UI,{" "}
            {transport === "tool" ? "tool transport" : "markdown transport"} (
            {agent === "langgraph" ? "LangGraph Python" : "built-in agent"})
          </h1>
          <p style={{ fontSize: 14, margin: "4px 0 0", opacity: 0.7 }}>
            Click a suggestion below the chat to try the standard components.
            The first three render into the surfaces on the page, outside the
            chat.
          </p>
          <nav
            style={{
              display: "flex",
              gap: 12,
              fontSize: 13,
              marginTop: 6,
              flexWrap: "wrap",
            }}
          >
            <span style={{ opacity: 0.6 }}>agent:</span>
            <Link
              href={href("default", transport)}
              aria-current={agent === "default"}
            >
              built-in
            </Link>
            <Link
              href={href("langgraph", transport)}
              aria-current={agent === "langgraph"}
            >
              LangGraph
            </Link>
            <span style={{ opacity: 0.6 }}>transport:</span>
            <Link
              href={href(agent, "markdown")}
              aria-current={transport === "markdown"}
            >
              markdown fences
            </Link>
            <Link
              href={href(agent, "tool")}
              aria-current={transport === "tool"}
            >
              render_ui tool
            </Link>
            <Link href="/catalog">catalog</Link>
          </nav>
        </header>
        <style>{LAYOUT_CSS}</style>
        <div className="example-layout">
          <PageSurfaces />
          <div className="example-chat">
            <Suggestions agent={agent} />
            <CopilotChat />
          </div>
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
