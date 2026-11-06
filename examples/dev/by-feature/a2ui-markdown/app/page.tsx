"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CopilotChat, useConfigureSuggestions } from "@copilotkit/react-core";
import { GenerativeUISurface } from "@copilotkit/react-core/generative-ui";
import Link from "next/link";
import { Providers } from "./providers";
import type { ExampleAgent, ExampleTransport } from "./providers";

/** "page": the chat next to two page surfaces. "chat": the chat alone, full width. */
type ExampleLayout = "page" | "chat";

interface Suggestion {
  title: string;
  message: string;
  /** The layouts the prompt makes sense in. Default: all. */
  layouts?: ExampleLayout[];
}

/**
 * Click-to-try prompts. Each one leans on a different part of the standard
 * components so the pills double as a quick tour: inputs and bindings, tables,
 * charts, forms, maps, SVG drawings, and flip cards.
 */
const SUGGESTIONS: Suggestion[] = [
  {
    layouts: ["page"],
    title: "Dashboard on the page",
    message:
      'Show a sales dashboard in the "dashboard" surface on the page, not in the chat: three stat cards (revenue, orders, average order value), a line chart of revenue over the last 6 months, and a table of the top 5 products.',
  },
  {
    layouts: ["page"],
    title: "Checklist in the notes",
    message:
      'Put a launch checklist in the "notes" surface on the page, not in the chat: a title and five checkboxes for the launch steps.',
  },
  {
    layouts: ["page"],
    title: "Update the dashboard",
    message:
      'Change the dashboard on the page: replace the line chart with a bar chart of orders per month, and add a badge "Best month" to the top month. Update the same surface; do not make a new one.',
  },
  {
    title: "Team plan estimator",
    message:
      "Build me an interactive team plan estimator: a slider for number of seats (1-50) at $29 per seat and a checkbox for annual billing with 20% discount. The monthly price, shown as formatted money, and a bar chart of the cumulative cost over 12 months must both update live as I move the slider or toggle the checkbox, without asking you again. Add a small comparison table of Starter/Team/Enterprise and a form with name and email plus a Request quote button that only works once the name is filled in and the email is valid.",
  },
  {
    title: "Table booking",
    message:
      "Make a table booking card: a field for my name, a date picker, a slider for the number of guests (1-8), and a sentence under them that reads like 'Table for 3 guests on Friday, Nov 7 for Ada' and updates live as I change the inputs, without asking you again. Add a Book button that sends the booking to you.",
  },
  {
    title: "Sign-up with validation",
    message:
      "Build a sign-up form: name (at least 2 characters), email (must be valid), password (at least 8 characters), and a checkbox to accept the terms. Each field shows its own error message, and the Create account button stays disabled until everything is valid. When I click it, tell me what I entered.",
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
    title: "How an engine works",
    message:
      "Explain how a four-stroke car engine works with an interactive SVG drawing of one cylinder in cross-section: cylinder wall, piston, connecting rod, crankshaft, intake and exhaust valves, spark plug. Add four buttons for the strokes (intake, compression, power, exhaust). When I click one, redraw the piston, valves and crank in that position, highlight the moving parts in a different colour, and explain in two sentences what happens in that stroke.",
  },
  {
    title: "Spanish flashcards",
    message:
      "Make me five flashcards to learn Spanish greetings. Show them as flip cards in a grid and add a button that asks you for five more.",
  },
];

function Suggestions({
  agent,
  layout,
}: {
  agent: ExampleAgent;
  layout: ExampleLayout;
}) {
  // The prompts that target a page surface only make sense when the page
  // surfaces are there.
  const suggestions = SUGGESTIONS.filter(
    ({ layouts }) => layouts === undefined || layouts.includes(layout),
  ).map(({ title, message }) => ({ title, message }));
  useConfigureSuggestions(
    { suggestions, available: "always", consumerAgentId: agent },
    [agent, layout],
  );
  return null;
}

/** Shown in a page surface until the agent renders into it. */
function EmptySurface({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="ex-empty">
      <p className="ex-empty-title">{title}</p>
      <p className="ex-empty-text">{hint}</p>
    </div>
  );
}

/**
 * Two named surfaces outside the chat. The model learns their ids and
 * descriptions from the manifest, and renders into them with a target.
 */
function PageSurfaces() {
  return (
    <section className="ex-panel" aria-labelledby="page-surfaces-title">
      <div className="ex-panel-header">
        <div>
          <h2 id="page-surfaces-title" className="ex-panel-title">
            On the page
          </h2>
          <p className="ex-panel-hint">
            Surfaces outside the chat. The agent renders into them by id.
          </p>
        </div>
        <span className="ex-tag">2 targets</span>
      </div>
      <div className="ex-panel-body">
        <div className="ex-slot ex-slot-main">
          <div className="ex-slot-label">
            Dashboard <code>dashboard</code>
          </div>
          <GenerativeUISurface
            id="dashboard"
            className="ex-slot-surface"
            description="The main panel of the page, to the left of the chat. Use it for dashboards, charts, and tables that the user asks to show on the page."
            fallback={
              <EmptySurface
                title="Nothing here yet"
                hint='Try the "Dashboard on the page" suggestion.'
              />
            }
          />
        </div>
        <div className="ex-slot">
          <div className="ex-slot-label">
            Notes <code>notes</code>
          </div>
          <GenerativeUISurface
            id="notes"
            className="ex-slot-surface"
            description="A small card under the dashboard. Use it for short notes, checklists, and summaries that the user asks to keep on the page."
            fallback={
              <EmptySurface
                title="Nothing here yet"
                hint='Try the "Checklist in the notes" suggestion.'
              />
            }
          />
        </div>
      </div>
    </section>
  );
}

function Chat() {
  const searchParams = useSearchParams();
  const agent: ExampleAgent =
    searchParams.get("agent") === "langgraph" ? "langgraph" : "default";
  const transport: ExampleTransport =
    searchParams.get("transport") === "tool" ? "tool" : "markdown";
  const layout: ExampleLayout =
    searchParams.get("layout") === "chat" ? "chat" : "page";
  const href = (
    a: ExampleAgent,
    t: ExampleTransport,
    l: ExampleLayout = layout,
  ) => `/?agent=${a}&transport=${t}${l === "chat" ? "&layout=chat" : ""}`;
  const current = (active: boolean) => (active ? "page" : undefined);

  return (
    <Providers agent={agent} transport={transport}>
      <main className="ex-shell">
        <header className="ex-topbar">
          <div className="ex-brand">
            {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG logo */}
            <img src="/copilotkit-logo.svg" alt="CopilotKit" />
            <span className="ex-brand-divider" aria-hidden="true" />
            <div>
              <h1 className="ex-title">Generative UI</h1>
              <p className="ex-subtitle">
                {transport === "tool"
                  ? "The agent calls the render_ui tool."
                  : "The agent writes a2ui code fences in its reply."}
              </p>
            </div>
          </div>
          <nav className="ex-controls" aria-label="Example settings">
            <div className="ex-segment" role="group" aria-label="Agent">
              <span className="ex-segment-label">Agent</span>
              <Link
                className="ex-pill"
                href={href("default", transport)}
                aria-current={current(agent === "default")}
              >
                Built-in
              </Link>
              <Link
                className="ex-pill"
                href={href("langgraph", transport)}
                aria-current={current(agent === "langgraph")}
              >
                LangGraph
              </Link>
            </div>
            <div className="ex-segment" role="group" aria-label="Transport">
              <span className="ex-segment-label">Transport</span>
              <Link
                className="ex-pill"
                href={href(agent, "markdown")}
                aria-current={current(transport === "markdown")}
              >
                Markdown
              </Link>
              <Link
                className="ex-pill"
                href={href(agent, "tool")}
                aria-current={current(transport === "tool")}
              >
                Tool
              </Link>
            </div>
            <div className="ex-segment" role="group" aria-label="Layout">
              <span className="ex-segment-label">Layout</span>
              <Link
                className="ex-pill"
                href={href(agent, transport, "page")}
                aria-current={current(layout === "page")}
              >
                Page
              </Link>
              <Link
                className="ex-pill"
                href={href(agent, transport, "chat")}
                aria-current={current(layout === "chat")}
              >
                Chat
              </Link>
            </div>
            <Link className="ex-pill ex-pill-plain" href="/catalog">
              Catalog
            </Link>
          </nav>
        </header>
        <div
          className={
            layout === "chat" ? "ex-layout ex-layout-chat" : "ex-layout"
          }
        >
          {/* Without the page surfaces, the manifest lists only the chat as
              a target, so the agent renders everything in the reply. */}
          {layout === "page" ? <PageSurfaces /> : null}
          <section className="ex-panel ex-panel-chat" aria-label="Chat">
            <div className="ex-chat">
              <Suggestions agent={agent} layout={layout} />
              <CopilotChat />
            </div>
          </section>
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
