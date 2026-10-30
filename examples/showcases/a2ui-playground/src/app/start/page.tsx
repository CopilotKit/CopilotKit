import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { GitHubIcon, SiteHeader } from "@/components/site/site-header";
import { CodeBlock, CommandLine } from "@/components/start/code-block";
import { DOCS_URL, REPO_NAME, REPO_URL } from "@/components/start/links";
import { ADK_AGENT, ADK_ROUTE, ADK_RUN, ADK_SERVER, CATALOG, EXPORT_CATALOG, EXPRESS, INSTALL, PROVIDER, ROUTE } from "@/components/start/snippets";

export const metadata: Metadata = {
  title: "Get started | A2UI Playground",
  description:
    "Use A2UI 1.0 in your app with CopilotKit Gen UI 2.0: define a catalog of your React components, add the provider and a Gemini runtime route, let the model write A2UI Express, and bring any agent, Google ADK included.",
};

/** Inline code in running text. */
function C({ children }: { children: React.ReactNode }) {
  return <code className="rounded-[5px] bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.86em] text-foreground">{children}</code>;
}

const STEPS = [
  {
    n: "01",
    title: "Define a catalog",
    file: "app/genui.tsx",
    code: CATALOG,
    body: (
      <>
        Start from <C>standardUI</C>, the 69 Gen UI 2.0 standard components, and add your own: a React component, a Zod schema for its props and one line the
        model reads. The agent can use only what the catalog defines.
      </>
    ),
  },
  {
    n: "02",
    title: "Wrap your app in the provider",
    file: "app/page.tsx",
    code: PROVIDER,
    body: (
      <>
        <C>{"generativeUI={{ ui }}"}</C> sends the catalog with every run. Surfaces render in <C>CopilotChat</C>, or in a <C>{"<GenerativeUISurface id>"}</C>{" "}
        placed anywhere on the page.
      </>
    ),
  },
  {
    n: "03",
    title: "Add a runtime route",
    file: "app/api/copilotkit/[[...slug]]/route.ts",
    code: ROUTE,
    body: (
      <>
        Because the browser sends a catalog, the runtime gives the agent a <C>render_ui</C> tool and a guide to your components, then validates every A2UI
        operation before it reaches the browser. This agent runs on Gemini Flash and reads a Gemini API key from <C>GOOGLE_API_KEY</C>.
      </>
    ),
  },
  {
    n: "04",
    title: "Let the model write Express",
    file: "src/agent/express.ts, shortened",
    code: EXPRESS,
    body: (
      <>
        This is how the playground works. Instead of JSON in a tool call, Gemini writes A2UI Express: one line per component, the format Google&apos;s A2UI
        SDKs default to. <C>@a2ui/agent</C> compiles it against your catalog into the same A2UI 1.0 messages, so any model can write it. A{" "}
        <Link href="/components/macros" className="text-foreground underline underline-offset-4">
          macro
        </Link>{" "}
        such as <C>WeatherReport</C> is one line too, and the server expands it into standard components.
      </>
    ),
  },
];

const FLOW = [
  ["Browser", "CopilotKitProvider + catalog"],
  ["CopilotKit runtime", "adds render_ui, validates ops"],
  ["ADK agent", "Gemini via ag-ui-adk"],
];

export default function StartPage() {
  return (
    <div className="pg-root min-h-[100dvh] bg-black">
      <SiteHeader active="start" />
      <main>
        <section className="landing-container pb-16 pt-20">
          <h1 className="max-w-[18ch] text-[44px] font-semibold leading-[1.05] tracking-[-0.02em] text-balance">Use it in your app</h1>
          <p className="mt-5 max-w-[62ch] text-[16px] leading-relaxed text-muted-foreground">
            Three files give your agent your own React components: a catalog, the provider and a runtime route. The agent answers in A2UI 1.0, and CopilotKit
            renders each component as it streams. Step 04 shows how the playground has Gemini write A2UI Express instead of JSON.
          </p>
          <CommandLine command={INSTALL} className="mt-8 max-w-[760px]" />
          <p className="mt-3 text-[13px] text-muted-foreground">The versions this site runs, with React 19 and Next.js 16.</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {REPO_URL ? (
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-[14px] font-medium text-background transition-opacity hover:opacity-90"
              >
                <GitHubIcon className="size-4" /> Get the code
              </a>
            ) : (
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-[14px] font-medium text-background transition-opacity hover:opacity-90"
              >
                Read the CopilotKit docs <ArrowUpRight className="size-4" />
              </a>
            )}
            <Link href="/" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-[14px] font-medium transition-colors hover:bg-white/[0.04]">
              Try it in the playground <ArrowRight className="size-4" />
            </Link>
            <Link href="/watch" className="inline-flex h-10 items-center rounded-lg px-2 text-[14px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline">
              Watch a build, step by step
            </Link>
          </div>
        </section>

        <section className="border-t border-border">
          <ol className="landing-container flex flex-col gap-20 py-24">
            {STEPS.map((s) => (
              <li key={s.n} className="grid gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,9fr)] lg:gap-12">
                <div className="lg:pt-2">
                  <span className="font-mono text-[13px] text-muted-foreground">{s.n}</span>
                  <h2 className="mt-4 text-[22px] font-semibold tracking-tight">{s.title}</h2>
                  <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
                <CodeBlock code={s.code} file={s.file} />
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-border">
          <div className="landing-container py-24">
            <h2 className="text-[28px] font-semibold tracking-tight">Bring your own agent: Google ADK</h2>
            <p className="mt-3 max-w-[70ch] text-[15.5px] leading-relaxed text-muted-foreground">
              The runtime fronts any agent that speaks AG-UI. <C>examples/adk</C> is a plain ADK <C>LlmAgent</C> on Gemini Flash, served with{" "}
              <C>ag-ui-adk</C>. It has no A2UI code: the runtime adds <C>render_ui</C> and the catalog guide to each request it forwards, and checks every
              operation the agent sends back.
            </p>

            <ol className="mt-10 grid grid-cols-1 items-center gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:gap-4">
              {FLOW.map(([a, b], i) => (
                <li key={a} className="contents">
                  <span className="rounded-xl border border-border bg-white/[0.02] px-5 py-4">
                    <span className="block text-[16px] font-semibold tracking-tight text-foreground">{a}</span>
                    <span className="mt-1 block font-mono text-[12.5px] text-muted-foreground">{b}</span>
                  </span>
                  {i < FLOW.length - 1 ? <ArrowRight className="mx-auto size-5 rotate-90 text-muted-foreground md:rotate-0" aria-hidden /> : null}
                </li>
              ))}
            </ol>

            <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <CodeBlock code={ADK_AGENT} file="examples/adk/agent.py" lang="py" />
              <CodeBlock code={ADK_SERVER} file="examples/adk/server.py" lang="py" />
            </div>
            <CodeBlock code={ADK_ROUTE} file="src/app/api/adk/[[...slug]]/route.ts" className="mt-6" />

            {REPO_URL ? (
              <>
                <h3 className="mt-14 text-[18px] font-semibold tracking-tight">Run it</h3>
                <p className="mt-2 text-[15px] text-muted-foreground">
                  Needs Python 3.11+, <C>uv</C> and a Gemini API key. <C>ADK_MODEL</C> picks the model, <C>ADK_AGENT_URL</C> points the route at an agent
                  elsewhere.
                </p>
                <CodeBlock code={ADK_RUN} file="terminal" lang="sh" className="mt-5" />
              </>
            ) : null}
          </div>
        </section>

        <section className="border-t border-border">
          <div className="landing-container py-24">
            <h2 className="text-[28px] font-semibold tracking-tight">Any renderer, any agent</h2>
            <p className="mt-3 max-w-[70ch] text-[15.5px] leading-relaxed text-muted-foreground">
              The catalog is not tied to React. CopilotKit exports it as an A2UI v1.0 catalog document, so another renderer can implement the same components and
              any agent or validator can read them.
            </p>
            <div className="mt-10 grid gap-4 md:grid-cols-2">
              <a
                href="/catalog.json"
                className="group flex flex-col rounded-xl border border-border bg-white/[0.02] p-6 transition-colors hover:border-[oklch(1_0_0/16%)] hover:bg-white/[0.035]"
              >
                <span className="font-mono text-[13px] text-muted-foreground">/catalog.json</span>
                <span className="mt-3 flex items-center gap-1.5 text-[18px] font-semibold tracking-tight">
                  Catalog document <ArrowUpRight className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                </span>
                <span className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
                  This site&apos;s catalog in the A2UI v1.0 format: a JSON Schema for each component, the functions and the design guidelines. Build a renderer
                  for another framework from it.
                </span>
              </a>
              <Link
                href="/skills"
                className="group flex flex-col rounded-xl border border-border bg-white/[0.02] p-6 transition-colors hover:border-[oklch(1_0_0/16%)] hover:bg-white/[0.035]"
              >
                <span className="font-mono text-[13px] text-muted-foreground">/skills</span>
                <span className="mt-3 flex items-center gap-1.5 text-[18px] font-semibold tracking-tight">
                  Agent skills <ArrowRight className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                </span>
                <span className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
                  Skills generated from the same catalog, so an agent that writes A2UI itself knows the components and how to put them together.
                </span>
              </Link>
            </div>
            <div className="mt-10 max-w-[760px]">
              <p className="mb-4 text-[15px] text-muted-foreground">Export your own catalog the same way:</p>
              <CodeBlock code={EXPORT_CATALOG} file="export-catalog.ts" />
            </div>
          </div>
        </section>

        <section className="border-t border-border">
          <p className="landing-container py-14 text-center text-[14.5px] text-muted-foreground">
            <a href={REPO_URL ?? DOCS_URL} target="_blank" rel="noreferrer" className="text-foreground underline-offset-4 hover:underline">
              {REPO_NAME ?? "CopilotKit docs"}
            </a>
            <span className="px-2.5 text-muted-foreground/50">/</span>
            <Link href="/" className="text-foreground underline-offset-4 hover:underline">
              Open the playground
            </Link>
            <span className="px-2.5 text-muted-foreground/50">/</span>
            <Link href="/watch" className="text-foreground underline-offset-4 hover:underline">
              Watch a build
            </Link>
            <span className="px-2.5 text-muted-foreground/50">/</span>
            <Link href="/components" className="text-foreground underline-offset-4 hover:underline">
              Browse the components
            </Link>
          </p>
        </section>
      </main>
      <footer className="landing-container border-t border-border py-8 text-[12.5px] text-muted-foreground">Built with CopilotKit, AG-UI and A2UI.</footer>
    </div>
  );
}
