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

/** "page": the chat next to two page surfaces. "chat": the chat alone, full width. */
type ExampleLayout = "page" | "chat";

interface Suggestion {
  title: string;
  message: string;
  /** The layouts the prompt makes sense in. Default: all. */
  layouts?: ExampleLayout[];
}

/** Everyday requests: the agent chooses the components and interactions. */
const SUGGESTIONS: Suggestion[] = [
  {
    layouts: ["page"],
    title: "Dashboard on the page",
    message:
      "Keep a sales overview on the page. Our revenue was $18,000 in January, $21,000 in February, $19,000 in March, $26,000 in April, $28,000 in May, and $34,000 in June. How are we doing?",
  },
  {
    layouts: ["page"],
    title: "Checklist in the notes",
    message:
      "Keep a launch checklist in the notes area so I can tick off the work as I go.",
  },
  {
    layouts: ["page"],
    title: "Update the dashboard",
    message:
      "Which month grew fastest? Focus the sales overview on month-to-month growth.",
  },
  {
    title: "Team plan estimator",
    message:
      "We pay $29 per person each month, or 20% less with annual billing. Help me work out the cost for a group of 1 to 50 people.",
  },
  {
    title: "Team Plan Estimator (old)",
    message:
      "Build me an interactive team plan estimator: a slider for number of seats (1-50) at $29 per seat and a checkbox for annual billing with 20% discount. The monthly price, shown as formatted money, and a bar chart of the cumulative cost over 12 months must both update live as I move the slider or toggle the checkbox, without asking you again. Add a small comparison table of Starter/Team/Enterprise and a form with name and email plus a Request quote button that only works once the name is filled in and the email is valid.",
  },
  {
    title: "Table booking",
    message:
      "Help me prepare a dinner reservation request for Friday, for 2 to 8 people. You will need my name and preferred time.",
  },
  {
    title: "Request access",
    message:
      "Help me draft a request to join a community. Ask for my name, email, and whether I accept the terms, then summarize my answers.",
  },
  {
    title: "Compare laptops",
    message:
      "Help me choose a laptop for video editing. My options are a $900 model with 16 GB RAM and 512 GB storage, a $1,300 model with 32 GB and 1 TB, and a $1,700 model with 64 GB and 2 TB. My budget is $1,400.",
  },
  {
    title: "Trip budget",
    message:
      "Help me plan five days in Lisbon on about €100 a day. Use rough estimates and let me adjust the budget.",
  },
  {
    title: "Workout planner",
    message:
      "Help me plan workouts that fit my goal and the time I have each week.",
  },
  {
    title: "Vienna coffee houses",
    message:
      "I would like to explore Vienna's historic coffee houses. Help me choose a few to visit.",
  },
  {
    title: "How an engine works",
    message:
      "Help me understand the four strokes of a car engine. Let me explore what happens at each stage.",
  },
  {
    title: "Spanish practice",
    message:
      "Help me practice basic Spanish greetings, and let me ask for more when I am ready.",
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
