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
import {
  FORMATS,
  DEMOS,
  MODELS,
  TRANSPORTS,
  getAgentId,
  readSettings,
} from "./settings";
import type { ExampleDemo, ExampleSettings } from "./settings";
import { CHARTING_SUGGESTIONS } from "./demo-catalogs";

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
  demo,
}: {
  agent: string;
  layout: ExampleLayout;
  demo: ExampleDemo;
}) {
  // The prompts that target a page surface only make sense when the page
  // surfaces are there.
  const suggestions =
    demo === "charting"
      ? CHARTING_SUGGESTIONS.map(({ title, message }) => ({
          title,
          message: `${layout === "page" ? 'Render in the "dashboard" surface on the page, not in the chat.' : "Render the chart in the chat."} ${message}`,
        }))
      : SUGGESTIONS.filter(
          ({ layouts }) => layouts === undefined || layouts.includes(layout),
        ).map(({ title, message }) => ({ title, message }));
  useConfigureSuggestions(
    { suggestions, available: "always", consumerAgentId: agent },
    [agent, layout, demo],
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
 * Named surfaces outside the chat. The model learns their ids and
 * descriptions from the manifest, and renders into them with a target.
 */
function PageSurfaces({ demo }: { demo: ExampleDemo }) {
  const charting = demo === "charting";
  return (
    <section className="ex-panel" aria-labelledby="page-surfaces-title">
      <div className="ex-panel-header">
        <div>
          <h2 id="page-surfaces-title" className="ex-panel-title">
            {charting ? "Charts on the page" : "On the page"}
          </h2>
          <p className="ex-panel-hint">
            Surfaces outside the chat. The agent renders into them by id.
          </p>
        </div>
        <span className="ex-tag">{charting ? "1 target" : "2 targets"}</span>
      </div>
      <div className="ex-panel-body">
        <div className="ex-slot ex-slot-main">
          <div className="ex-slot-label">
            {charting ? "Charts" : "Dashboard"} <code>dashboard</code>
          </div>
          <GenerativeUISurface
            id="dashboard"
            className="ex-slot-surface"
            description={
              charting
                ? "The main chart panel, to the left of the chat. Use it for charts and supporting labels that the user asks to show on the page."
                : "The main panel of the page, to the left of the chat. Use it for dashboards, charts, and tables that the user asks to show on the page."
            }
            fallback={
              <EmptySurface
                title="Nothing here yet"
                hint={
                  charting
                    ? 'Try the "Revenue trend" suggestion, or describe a chart.'
                    : 'Try the "Dashboard on the page" suggestion.'
                }
              />
            }
          />
        </div>
        {!charting ? (
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
        ) : null}
      </div>
    </section>
  );
}

const current = (active: boolean) => (active ? "page" : undefined);

function Chat() {
  const searchParams = useSearchParams();
  const settings = readSettings(searchParams);
  const { model, format, transport, demo } = settings;
  const agent = getAgentId(settings);
  const layout: ExampleLayout =
    searchParams.get("layout") === "chat" ? "chat" : "page";
  const href = (
    changes: Partial<ExampleSettings>,
    l: ExampleLayout = layout,
  ) => {
    const params = new URLSearchParams({ ...settings, ...changes, layout: l });
    return `/?${params}`;
  };

  return (
    // A new provider owns a new core, thread, chat, and surface manager.
    // Returning to an earlier combination also creates a fresh instance.
    <Providers key={`${agent}-${demo}`} settings={settings}>
      <main className="ex-shell">
        <header className="ex-topbar">
          <div className="ex-brand">
            {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG logo */}
            <img src="/copilotkit-logo.svg" alt="CopilotKit" />
            <span className="ex-brand-divider" aria-hidden="true" />
            <div>
              <h1 className="ex-title">
                {demo === "charting"
                  ? "Charting with Google ADK"
                  : "Generative UI with Google ADK"}
              </h1>
              <p className="ex-subtitle">
                {transport === "tool"
                  ? "The agent calls the render_ui tool."
                  : "The agent writes a2ui code fences in its reply."}
              </p>
            </div>
          </div>
          <nav className="ex-controls" aria-label="Example settings">
            <div className="ex-segment" role="group" aria-label="Demo">
              <span className="ex-segment-label">Demo</span>
              {DEMOS.map((value) => (
                <Link
                  key={value}
                  className="ex-pill"
                  href={href({ demo: value })}
                  aria-current={current(demo === value)}
                >
                  {value === "charting" ? "Charting" : "General"}
                </Link>
              ))}
            </div>
            <div className="ex-segment" role="group" aria-label="Model">
              <span className="ex-segment-label">Model</span>
              {MODELS.map((value) => (
                <Link
                  key={value}
                  className="ex-pill"
                  href={href({ model: value })}
                  aria-current={current(model === value)}
                >
                  {value === "gemini-3.6-flash"
                    ? "Gemini 3.6 Flash"
                    : "Gemini 3.8 Flash"}
                </Link>
              ))}
            </div>
            <div className="ex-segment" role="group" aria-label="Format">
              <span className="ex-segment-label">Format</span>
              {FORMATS.map((value) => (
                <Link
                  key={value}
                  className="ex-pill"
                  href={href({ format: value })}
                  aria-current={current(format === value)}
                >
                  {value === "express" ? "Express" : "JSON"}
                </Link>
              ))}
            </div>
            <div className="ex-segment" role="group" aria-label="Transport">
              <span className="ex-segment-label">Transport</span>
              {TRANSPORTS.map((value) => (
                <Link
                  key={value}
                  className="ex-pill"
                  href={href({ transport: value })}
                  aria-current={current(transport === value)}
                >
                  {value === "markdown" ? "Markdown" : "Tool"}
                </Link>
              ))}
            </div>
            <div className="ex-segment" role="group" aria-label="Layout">
              <span className="ex-segment-label">Layout</span>
              <Link
                className="ex-pill"
                href={href({}, "page")}
                aria-current={current(layout === "page")}
              >
                Page
              </Link>
              <Link
                className="ex-pill"
                href={href({}, "chat")}
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
        <p className="ex-settings-note">
          Markdown streams with a Google API key. Tool mode uses real tool calls
          and may render only after their arguments are complete. This demo uses
          the Gemini API, with no Vertex AI setup. Changing demo, model, format,
          or transport starts a fresh chat and clears all surfaces.
        </p>
        <div
          className={
            layout === "chat" ? "ex-layout ex-layout-chat" : "ex-layout"
          }
        >
          {/* Without the page surfaces, the manifest lists only the chat as
              a target, so the agent renders everything in the reply. */}
          {layout === "page" ? <PageSurfaces demo={demo} /> : null}
          <section className="ex-panel ex-panel-chat" aria-label="Chat">
            <div className="ex-chat">
              <Suggestions agent={agent} layout={layout} demo={demo} />
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
