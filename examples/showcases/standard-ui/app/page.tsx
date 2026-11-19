"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ReactElement,
} from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CopilotChat,
  useAgent,
  useConfigureSuggestions,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import { GenerativeUISurface } from "@copilotkit/react-core/v2/generative-ui";
import { Providers } from "./providers";
import type { DemoErrorHandler, DemoTransport } from "./providers";
import {
  Backdrop,
  COMPONENT_COUNT,
  DocsButton,
  SectionTitle,
  Sidebar,
} from "./shell";
import { SAMPLE_PROMPT, SpecimenPlate } from "./specimen-plate";
import { ArrowRight, Close, Tick } from "./icons";

/** "chat": the chat alone (the default). "page": the chat next to two page surfaces. */
type DemoLayout = "chat" | "page";

interface Prompt {
  title: string;
  /** One line on what comes back. */
  blurb: string;
  /** The standard components the prompt is likely to use, shown as tags. */
  sets: string[];
  message: string;
  /** The layouts the prompt makes sense in. Default: all. */
  layouts?: DemoLayout[];
}

/**
 * Prompts that tour the standard components: stat cards and charts, forms
 * with validation, tables, maps, checklists, live bindings, flip cards and
 * SVG. They show twice: as the sidebar list (with the components each is
 * likely to use; `sets` is a caption, not a contract) and as the chat's
 * default suggestion pills.
 */
const PROMPTS: Prompt[] = [
  {
    layouts: ["chat"],
    title: "Sales dashboard",
    blurb: "Stat cards, a revenue chart and a top-products table.",
    sets: ["Card", "Chart", "Table"],
    message:
      "Show me a sales dashboard: three stat cards side by side (revenue, orders, average order value), each with its trend versus last month, then a line chart of revenue over the last 6 months, and a table of the top 5 products.",
  },
  {
    layouts: ["page"],
    title: "Dashboard on the page",
    blurb: "Renders into the page's dashboard surface.",
    sets: ["Card", "Chart", "Table"],
    message:
      'Show a sales dashboard in the "dashboard" surface on the page, not in the chat: three stat cards side by side (revenue, orders, average order value), then a line chart of revenue over the last 6 months, and a table of the top 5 products.',
  },
  {
    title: "Sign-up form",
    blurb: "Validated fields; the button waits until all are valid.",
    sets: ["Form", "TextField", "CheckBox"],
    message:
      "Build a sign-up form: name (at least 2 characters), email (must be valid), password (at least 8 characters), and a checkbox to accept the terms. Each field shows its own error message, and the Create account button stays disabled until everything is valid. When I click it, tell me what I entered.",
  },
  {
    title: "Compare laptops",
    blurb: "A comparison table with a best-value badge.",
    sets: ["Table", "Badge", "Button"],
    message:
      "Pick three popular laptops for video editing yourself (illustrative specs are fine) and compare them in a table: price, CPU, RAM, screen and battery. Mark the best value with a badge, and give each one a button that tells you which I picked.",
  },
  {
    title: "Trip budget chart",
    blurb: "A five-day itinerary and a daily budget chart.",
    sets: ["List", "Chart"],
    message:
      "Plan a 5-day trip to Lisbon: a day-by-day itinerary list, and a bar chart of the estimated daily budget split into food, transport and activities.",
  },
  {
    title: "Cafés on a map",
    blurb: "Four Vienna coffee houses as map markers.",
    sets: ["Map", "List"],
    message:
      "Show four famous coffee houses in Vienna on a map with markers, and a short list underneath with one line about each.",
  },
  {
    layouts: ["chat"],
    title: "Launch checklist",
    blurb: "Checkboxes with a live count of what's done.",
    sets: ["CheckBox", "Text"],
    message:
      "Make a product launch checklist: a title, six checkboxes for the launch steps split into 'Before launch' and 'Launch day', and a line under them that counts how many are done and updates live as I tick them, without asking you again.",
  },
  {
    layouts: ["page"],
    title: "Checklist in the notes",
    blurb: "Renders into the page's notes surface.",
    sets: ["CheckBox", "Title"],
    message:
      'Put a launch checklist in the "notes" surface on the page, not in the chat: a title and five checkboxes for the launch steps.',
  },
  {
    layouts: ["page"],
    title: "Update the dashboard",
    blurb: "Changes the dashboard surface in place.",
    sets: ["Chart", "Badge"],
    message:
      'Change the dashboard on the page: replace the line chart with a bar chart of orders per month, and add a badge "Best month" to the top month. Update the same surface; do not make a new one.',
  },
  {
    title: "Team plan estimator",
    blurb: "A slider and a checkbox drive the price and chart live.",
    sets: ["Slider", "CheckBox", "Chart"],
    message:
      "Build me an interactive team plan estimator: a slider for number of seats (1-50) at $29 per seat and a checkbox for annual billing with 20% discount. The monthly price, shown as formatted money, and a bar chart of the cumulative cost over 12 months must both update live as I move the slider or toggle the checkbox, without asking you again.",
  },
  {
    title: "Spanish flashcards",
    blurb: "Flip cards one after another, and a button for more.",
    sets: ["FlashcardFlip", "Button"],
    message:
      "Make me five flashcards to learn Spanish greetings. Show them as flip cards stacked one after the other, and add a button that asks you for five more.",
  },
  {
    title: "How an engine works",
    blurb: "An interactive SVG with a button per stroke.",
    sets: ["Svg", "Button"],
    message:
      "Explain how a four-stroke car engine works with an interactive SVG drawing of one cylinder in cross-section: cylinder wall, piston, connecting rod, crankshaft, intake and exhaust valves, spark plug. Add four buttons for the strokes (intake, compression, power, exhaust). When I click one, redraw the piston, valves and crank in that position, highlight the moving parts in a different colour, and explain in two sentences what happens in that stroke.",
  },
];

const promptsFor = (layout: DemoLayout) =>
  PROMPTS.filter(
    ({ layouts }) => layouts === undefined || layouts.includes(layout),
  );

/* ───────────────────────── run failures ───────────────────────── */

/**
 * What to tell the visitor when a run fails. The runtime route answers a
 * refused run with `HTTP 429: {"error": "..."}` (rate limit) or 413 (chat too
 * long); show that text. Anything else gets a generic line.
 */
function runFailureNotice(error: Error) {
  const match = /HTTP (\d{3}): ([\s\S]*)$/.exec(error.message);
  if (match && (match[1] === "429" || match[1] === "413")) {
    try {
      const body = JSON.parse(match[2]) as { error?: unknown };
      if (typeof body.error === "string") return body.error;
    } catch {
      // Not the route's JSON: fall through to the generic line.
    }
  }
  return "The agent couldn't answer this time. Try again in a moment.";
}

/**
 * The failures that end a run with no reply: the request was refused or
 * failed (`agent_run_failed*`), or the model call failed and the stream
 * carried a RUN_ERROR (`agent_run_error_event`).
 */
const RUN_FAILURES = new Set([
  "agent_run_failed",
  "agent_run_failed_event",
  "agent_run_error_event",
]);

/** Shows why the last run failed, so a failed run isn't a silent blank reply. */
function useRunFailureNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const onError = useCallback<DemoErrorHandler>(({ error, code }) => {
    if (RUN_FAILURES.has(String(code))) setNotice(runFailureNotice(error));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 20_000);
    return () => clearTimeout(timer);
  }, [notice]);
  return { notice, onError, dismiss: () => setNotice(null) };
}

/* ───────────────────────── sidebar sections ───────────────────────── */

/** The chat's default suggestion pills, on every screen size and layout. */
function ChatSuggestions({ layout }: { layout: DemoLayout }) {
  const suggestions = promptsFor(layout).map(({ title, message }) => ({
    title,
    message,
  }));
  useConfigureSuggestions({ suggestions, available: "always" }, [layout]);
  return null;
}

/** The example prompts. Choosing one sends it; it is marked once the model answers. */
function PromptList({ layout }: { layout: DemoLayout }) {
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();
  const [sent, setSent] = useState<string[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const running = agent.isRunning || pending !== null;

  const send = async (prompt: Prompt) => {
    if (running) return;
    setPending(prompt.title);
    try {
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: prompt.message,
      });
      await copilotkit.runAgent({ agent });
      // Marked only when the model answered: a refused or failed run (the
      // provider's onError shows why) leaves the item as it was.
      const last = agent.messages[agent.messages.length - 1];
      if (last?.role === "assistant")
        setSent((current) =>
          current.includes(prompt.title) ? current : [...current, prompt.title],
        );
    } catch {
      // The provider's onError shows the failure; nothing to add here.
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="ck-section ck-prompts" aria-labelledby="ck-prompts">
      <SectionTitle id="ck-prompts">Example prompts</SectionTitle>
      <ul className="ck-list">
        {promptsFor(layout).map((prompt) => {
          const isSent = sent.includes(prompt.title);
          const isPending = pending === prompt.title;
          return (
            <li key={prompt.title}>
              <button
                type="button"
                className="ck-item ck-focus"
                data-selected={isSent || isPending ? "" : undefined}
                aria-busy={isPending || undefined}
                disabled={running}
                title={prompt.blurb}
                onClick={() => void send(prompt)}
              >
                <span className="ck-item-name">
                  {prompt.title}
                  {isSent && !isPending ? <Tick /> : <ArrowRight />}
                </span>
                {isPending ? (
                  <span className="ck-item-desc">Rendering…</span>
                ) : (
                  <span className="ck-tags">
                    {prompt.sets.map((name) => (
                      <span key={name} className="ck-tag">
                        {name}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const settingsHref = (t: DemoTransport, l: DemoLayout) => {
  const params = new URLSearchParams();
  if (t === "tool") params.set("transport", "tool");
  if (l === "page") params.set("layout", "page");
  const query = params.toString();
  return query ? `/?${query}` : "/";
};

/** Transport and layout. Links, so a setting can be shared by URL. */
function Controls({
  transport,
  layout,
  idPrefix,
}: {
  transport: DemoTransport;
  layout: DemoLayout;
  idPrefix: string;
}) {
  const current = (active: boolean) => (active ? "page" : undefined);
  return (
    <>
      <section className="ck-section" aria-labelledby={`${idPrefix}-transport`}>
        <SectionTitle id={`${idPrefix}-transport`}>Transport</SectionTitle>
        <div className="ck-tabs ck-tabs-sm">
          <Link
            href={settingsHref("markdown", layout)}
            className="ck-tab ck-focus"
            aria-current={current(transport === "markdown")}
          >
            Markdown
          </Link>
          <Link
            href={settingsHref("tool", layout)}
            className="ck-tab ck-focus"
            aria-current={current(transport === "tool")}
          >
            Tool
          </Link>
        </div>
        <p className="ck-note">
          {transport === "tool" ? (
            <>
              The agent calls <code>render_ui</code> and the runtime streams
              each surface.
            </>
          ) : (
            <>
              The agent writes <code>a2ui</code> fences in its reply and the
              chat renders them.
            </>
          )}
        </p>
      </section>
      <section className="ck-section" aria-labelledby={`${idPrefix}-layout`}>
        <SectionTitle id={`${idPrefix}-layout`}>Layout</SectionTitle>
        <div className="ck-tabs ck-tabs-sm">
          <Link
            href={settingsHref(transport, "chat")}
            className="ck-tab ck-focus"
            aria-current={current(layout === "chat")}
          >
            Chat
          </Link>
          <Link
            href={settingsHref(transport, "page")}
            className="ck-tab ck-focus"
            aria-current={current(layout === "page")}
          >
            Page
          </Link>
        </div>
      </section>
    </>
  );
}

/** The whole integration, as code. */
function Integration({
  transport,
  idPrefix,
}: {
  transport: DemoTransport;
  idPrefix: string;
}) {
  return (
    <section className="ck-section" aria-labelledby={`${idPrefix}-integration`}>
      <SectionTitle id={`${idPrefix}-integration`}>Integration</SectionTitle>
      <pre className="ck-code">
        <code>
          {"<CopilotKitProvider\n"}
          {'  runtimeUrl="/api/copilotkit"\n'}
          {"  generativeUI={{\n    "}
          <mark>ui: standardUI</mark>
          {",\n    transport: "}
          {transport === "tool" ? '"tool"' : '"markdown"'}
          {",\n  }}\n/>"}
        </code>
      </pre>
      <p className="ck-note">The whole integration: one provider prop.</p>
    </section>
  );
}

/* ───────────────────────── main ───────────────────────── */

/**
 * The empty chat: what to do, a sample answer (a
 * prompt and the surface that answers it) the visitor can drag, then the
 * composer, pinned to the bottom like the chat's own input. The suggestion
 * chips repeat the sidebar's example prompts, so they show only where that
 * list is hidden (phones, the collapsed rail, the page layout). Replaces the
 * stock "How can I help you today?".
 */
function Welcome({
  input,
  suggestionView,
}: {
  input: ReactElement;
  suggestionView: ReactElement;
}) {
  return (
    <div className="ck-welcome">
      <div className="ck-welcome-head">
        {/* The phone's Docs button: in the heading, so it scrolls away with
            it instead of floating over the sample. */}
        <DocsButton className="ck-welcome-docs" />
        <h2>What should the agent build?</h2>
        <p>
          Pick an example prompt or describe any interface. A live model answers
          with CopilotKit&rsquo;s {COMPONENT_COUNT} standard components, exactly
          as they ship.
        </p>
      </div>
      <figure className="ck-example">
        <SectionTitle>Sample answer</SectionTitle>
        <p className="ck-example-ask">{SAMPLE_PROMPT}</p>
        <div className="ck-example-frame">
          <SpecimenPlate />
        </div>
        <figcaption>
          A saved answer, rendered in your browser with no model call. Drag the
          slider.{" "}
          <Link href="/catalog" className="ck-focus">
            See all {COMPONENT_COUNT} in the catalog
          </Link>
        </figcaption>
      </figure>
      <div className="ck-welcome-chips">{suggestionView}</div>
      <div className="ck-compose">{input}</div>
    </div>
  );
}

/** Shown in a page surface until the agent renders into it. */
function EmptyTarget({ hint }: { hint: string }) {
  return <p className="ck-target-empty">{hint}</p>;
}

/**
 * Two named surfaces outside the chat. The model learns their ids and
 * descriptions from the manifest, and renders into them with a target.
 */
function PageSurfaces() {
  return (
    <section className="ck-surfaces" aria-labelledby="ck-surfaces">
      <SectionTitle id="ck-surfaces">On the page</SectionTitle>
      <p className="ck-note">
        Two surfaces outside the chat. The agent renders into them by id.
      </p>
      <figure className="ck-target">
        <figcaption>
          Target <code>dashboard</code>
        </figcaption>
        <div className="ck-target-frame">
          <GenerativeUISurface
            id="dashboard"
            description="The main panel of the page, to the left of the chat. Use it for dashboards, charts, and tables that the user asks to show on the page."
            fallback={
              <EmptyTarget hint='Empty. Try "Dashboard on the page".' />
            }
          />
        </div>
      </figure>
      <figure className="ck-target">
        <figcaption>
          Target <code>notes</code>
        </figcaption>
        <div className="ck-target-frame">
          <GenerativeUISurface
            id="notes"
            description="A small card under the dashboard. Use it for short notes, checklists, and summaries that the user asks to keep on the page."
            fallback={
              <EmptyTarget hint='Empty. Try "Checklist in the notes".' />
            }
          />
        </div>
      </figure>
    </section>
  );
}

/**
 * Replaces the chat's "can make mistakes" line under the input with empty
 * room of the same kind, through the input's documented `disclaimer` slot.
 */
function InputFoot() {
  return <div className="ck-input-foot" aria-hidden="true" />;
}

function ChatCard({
  notice,
  dismiss,
}: {
  notice: string | null;
  dismiss: () => void;
}) {
  return (
    <section className="ck-card" aria-label="Chat">
      <DocsButton className="ck-canvas-docs ck-chat-docs" />
      {notice ? (
        <div className="ck-notice" role="alert">
          <span>{notice}</span>
          <button type="button" onClick={dismiss} aria-label="Dismiss">
            <Close />
          </button>
        </div>
      ) : null}
      <CopilotChat
        className="ck-chat"
        welcomeScreen={Welcome as never}
        input={{ disclaimer: InputFoot }}
        labels={{
          chatInputPlaceholder: "Describe a UI to build",
        }}
      />
    </section>
  );
}

/* ───────────────────────── page ───────────────────────── */

function Demo() {
  const searchParams = useSearchParams();
  const transport: DemoTransport =
    searchParams.get("transport") === "tool" ? "tool" : "markdown";
  const layout: DemoLayout =
    searchParams.get("layout") === "page" ? "page" : "chat";
  const { notice, onError, dismiss } = useRunFailureNotice();

  return (
    // key: a new transport is a new provider, so the chat starts fresh.
    <Providers key={transport} transport={transport} onError={onError}>
      <Backdrop />
      <div className="ck-app" data-layout={layout}>
        <ChatSuggestions layout={layout} />
        <Sidebar current="chat">
          {layout === "chat" ? <PromptList layout={layout} /> : null}
          <div className="ck-wide-only ck-section-stack">
            <Integration transport={transport} idPrefix="w" />
            <Controls transport={transport} layout={layout} idPrefix="w" />
          </div>
          <details className="ck-more">
            <summary className="ck-focus">
              Settings
              <span>
                {transport === "tool" ? "Tool" : "Markdown"} ·{" "}
                {layout === "page" ? "Page" : "Chat"}
              </span>
            </summary>
            <div className="ck-more-body">
              <Controls transport={transport} layout={layout} idPrefix="n" />
              <Integration transport={transport} idPrefix="n" />
            </div>
          </details>
        </Sidebar>
        <main className="ck-main">
          {layout === "page" ? <PageSurfaces /> : null}
          <ChatCard notice={notice} dismiss={dismiss} />
        </main>
      </div>
    </Providers>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Demo />
    </Suspense>
  );
}
