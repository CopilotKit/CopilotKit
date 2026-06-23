import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Code2,
  Cpu,
  Github,
  KeyRound,
  Plug,
  Rocket,
  Server,
  Sparkles,
} from "lucide-react";
import { AboutToc, type TocItem } from "./toc";

export const metadata = {
  title:
    "About — Generative UI · Global Agents · Agentic Interfaces Hackathon Starter",
  description:
    "What ships with the kit, how to run it, and where to start hacking.",
};

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "about", label: "About this Kit" },
  { id: "quickstart", label: "Quickstart" },
  { id: "demos", label: "Demo prompts" },
  { id: "customize", label: "Customization" },
  { id: "vibe-coding", label: "Vibe coding" },
  { id: "env", label: "Required keys" },
  { id: "docs", label: "Documentation" },
];

const pillars = [
  {
    name: "CopilotKit",
    icon: Sparkles,
    href: "https://docs.copilotkit.ai",
    blurb:
      "Connects your app's logic, state, and user context to AI agents — across embedded UIs and headless interfaces. Ships with CopilotKit Intelligence wired in: durable Postgres-backed threads, a runtime that bridges any LangGraph agent, and built-in support for generative UI and MCP App composition.",
  },
  {
    name: "LangChain Deep Agents",
    icon: Cpu,
    href: "https://github.com/langchain-ai/deepagents",
    blurb:
      "A Python framework that gives an LLM built-in planning, sub-agent dispatch, a virtual filesystem, and a TODO loop — the patterns popularized by Claude Code and Manus, packaged as a single create_deep_agent(...) call on top of LangGraph. The kit uses Deep Agents as the brain behind the canvas.",
  },
  {
    name: "Gemini",
    icon: Rocket,
    href: "https://ai.google.dev/gemini-api/docs",
    blurb:
      "Gemini 3.1 Flash-Lite is Google's high-volume workhorse — fast, cheap, and tool-calling-capable. Default for chat. Drop in an API key from Google AI Studio, restart, and you're done. Switch to Pro, OpenAI, Anthropic, or Ollama with a one-line edit.",
  },
  {
    name: "Notion MCP",
    icon: Plug,
    href: "https://github.com/makenotion/notion-mcp-server",
    blurb:
      "Notion's official MCP server gives the agent first-class read/write access to a Notion workspace via the open Model Context Protocol. The kit calls it through mcp-use — no broker, no OAuth dance, just a Notion integration token and a per-database share. Swap in Linear, Slack, GitHub, or Drive MCP servers by changing one config dict.",
  },
  {
    name: "Manufact (mcp-use)",
    icon: Server,
    href: "https://mcp-use.com",
    blurb:
      "A deployment platform for MCP servers built on the open-source mcp-use framework. The kit's mcp/ package is a single-file MCP server that gives the agent a third surface — runnable inside Claude or ChatGPT directly. One command tunnels publicly; one command deploys to Manufact Cloud.",
  },
];

const quickstart = [
  {
    title: "Run the CLI",
    body: "npx @copilotkit/cli-vnext@latest init",
    note: "Select Intelligence when prompted. The early-access password is earlyaccess.",
  },
  {
    title: "Add your Gemini key",
    body: "GEMINI_API_KEY=AIza...",
    note: "Get a key at aistudio.google.com → Get API key. Drop it in BOTH .env and agent/.env (the agent reads its own dotenv).",
  },
  {
    title: "Install + run",
    body: "npm install && npm run dev",
    note: "Boots the Docker infra (Postgres + Redis + Intelligence), then UI + BFF + agent. Use npm run dev:full to also start the MCP server.",
  },
];

const demos = [
  {
    label: "Notion MCP (external integration)",
    items: [
      "Import the workshop leads from Notion.",
    ],
  },
  {
    label: "Canvas (agent-driven UI)",
    items: [
      "What's the most requested workshop?",
      "Open Ethan Moore.",
      "Show me demand stats.",
    ],
  },
  {
    label: "Multi-step planning (Deep Agents)",
    items: [
      "Draft an email to Ethan.",
    ],
  },
  {
    label: "Intelligence (durable threads)",
    items: [
      "Open my last thread from earlier.",
      "Reload the browser. The conversation is still in the sidebar.",
    ],
  },
  {
    label: "Manufact MCP — needs npm run dev:full",
    items: ["Use the Manufact tool to show a sample widget."],
  },
];

const docs = [
  { label: "CopilotKit docs", href: "https://docs.copilotkit.ai" },
  {
    label: "Intelligence Platform",
    href: "https://docs.copilotkit.ai/learn/intelligence-platform",
  },
  {
    label: "Coding Agents (vibe coding)",
    href: "https://docs.copilotkit.ai/coding-agents",
  },
  {
    label: "CopilotKit Skills",
    href: "https://github.com/CopilotKit/skills",
  },
  {
    label: "LangChain Deep Agents",
    href: "https://github.com/langchain-ai/deepagents",
  },
  { label: "Gemini API", href: "https://ai.google.dev/gemini-api/docs" },
  { label: "Notion MCP server", href: "https://github.com/makenotion/notion-mcp-server" },
  { label: "Model Context Protocol", href: "https://modelcontextprotocol.io" },
  {
    label: "Manufact / mcp-use",
    href: "https://mcp-use.com/docs/typescript/getting-started/quickstart",
  },
];

function Section({
  id,
  eyebrow,
  title,
  subtitle,
  children,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-16 scroll-mt-12 first:mt-0">
      {eyebrow ? (
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-accent">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
      {subtitle ? (
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {subtitle}
        </p>
      ) : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[0.8em]">
      {children}
    </code>
  );
}

export default function AboutPage() {
  return (
    <div className="mx-auto flex max-w-6xl gap-12 px-6 py-12 md:px-12 md:py-16">
      <main className="min-w-0 flex-1">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-accent"
        >
          <ArrowLeft size={14} aria-hidden />
          Back to canvas
        </Link>

        <header id="overview" className="scroll-mt-12">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-accent">
          Hackathon Starter
        </p>
        <h1 className="text-4xl font-semibold leading-tight text-foreground md:text-5xl">
          Generative UI{" "}
          <span className="text-muted-foreground/60">·</span> Global Agents{" "}
          <span className="text-muted-foreground/60">·</span> Agentic
          Interfaces
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          A complete AI agent starter for hackathon teams: durable
          conversation threads, an agent-driven canvas, real external
          integrations, and a deployable MCP App — all in one repo.
        </p>
        <div className="mt-6 overflow-hidden rounded-xl border bg-muted">
          <Image
            src="/banner.jpg"
            alt="Hackathon banner"
            width={1280}
            height={420}
            priority
            className="h-auto w-full object-cover"
          />
        </div>
      </header>

      <Section
        id="about"
        eyebrow="What you get"
        title="About this Starter Kit"
        subtitle="Five well-known pieces, wired together so a team of two can ship something credible in 24–48 hours."
      >
        <ul className="grid gap-4 md:grid-cols-2">
          {pillars.map(({ name, icon: Icon, blurb, href }) => (
            <li
              key={name}
              className="rounded-xl border bg-card p-5 shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/10 text-accent">
                  <Icon size={16} aria-hidden />
                </span>
                <h3 className="text-base font-semibold text-foreground">
                  {name}
                </h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {blurb}
              </p>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
              >
                More about {name}
                <span aria-hidden>→</span>
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="quickstart"
        eyebrow="Get running"
        title="Quickstart"
        subtitle="Three steps from clone to first agent reply."
      >
        <ol className="space-y-3">
          {quickstart.map((step, idx) => (
            <li key={step.title} className="rounded-xl border bg-card p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border bg-background text-xs font-semibold text-foreground">
                  {idx + 1}
                </span>
                <h3 className="text-base font-semibold text-foreground">
                  {step.title}
                </h3>
              </div>
              <pre className="mt-3 overflow-x-auto rounded-md border bg-muted px-4 py-3 font-mono text-sm text-foreground">
                {step.body}
              </pre>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {step.note}
              </p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-muted-foreground">
          On a fresh clone, <Code>.env.example</Code> ships a placeholder
          Gemini key; chat fails until you replace it. The agent will print a
          warning at startup so you don&apos;t miss it.
        </p>
      </Section>

      <Section
        id="demos"
        eyebrow="Try it out"
        title="Demo prompts"
        subtitle="Drop these into the chat to exercise each layer of the stack."
      >
        <div className="space-y-6">
          {demos.map((group) => (
            <div key={group.label}>
              <h3 className="mb-2 text-sm font-semibold text-foreground">
                {group.label}
              </h3>
              <ul className="space-y-2">
                {group.items.map((item) => (
                  <li
                    key={item}
                    className="rounded-lg border bg-card px-4 py-3 text-sm text-foreground"
                  >
                    &ldquo;{item}&rdquo;
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="customize"
        eyebrow="Make it yours"
        title="Customization"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border bg-card p-5">
            <div className="flex items-center gap-2">
              <Code2 size={16} className="text-accent" aria-hidden />
              <h3 className="text-sm font-semibold text-foreground">
                Add a card type
              </h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Extend <Code>CardType</Code> in{" "}
              <Code>src/lib/canvas/types.ts</Code>, render its branch in{" "}
              <Code>src/components/canvas/CardRenderer.tsx</Code>, then add
              one mutation tool via <Code>useFrontendTool</Code> in{" "}
              <Code>src/app/page.tsx</Code>. Tell the agent about it in{" "}
              <Code>agent/src/prompts.py</Code>.
            </p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <div className="flex items-center gap-2">
              <Plug size={16} className="text-accent" aria-hidden />
              <h3 className="text-sm font-semibold text-foreground">
                Swap the integration MCP server
              </h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Pick a different MCP server from the{" "}
              <a
                className="text-accent hover:underline"
                href="https://github.com/modelcontextprotocol/servers"
                target="_blank"
                rel="noopener noreferrer"
              >
                MCP server registry
              </a>
              , swap the <Code>mcpServers</Code> config dict in{" "}
              <Code>agent/src/notion_mcp.py</Code>, then edit{" "}
              <Code>INTEGRATION_PROMPT</Code> in{" "}
              <Code>agent/src/prompts.py</Code> with the new vocabulary.
              Restart the agent. Done.
            </p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <div className="flex items-center gap-2">
              <Server size={16} className="text-accent" aria-hidden />
              <h3 className="text-sm font-semibold text-foreground">
                Add an MCP App tool
              </h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Edit <Code>mcp/index.ts</Code> and add another{" "}
              <Code>server.tool(...)</Code>. The runtime auto-discovers it on
              the next reload. Want a fresh server alongside?{" "}
              <Code>npx create-mcp-use-app@latest</Code>. Or point at a
              remote one with <Code>MCP_SERVER_URL</Code>.
            </p>
          </div>
        </div>
      </Section>

      <Section
        id="vibe-coding"
        eyebrow="Vibe coding"
        title="Plug your coding agent in"
        subtitle="Cursor, Claude Code, and Codex all benefit from these — they give the agent the canonical patterns for useFrontendTool, useAgent, and the runtime configuration shapes."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <a
            href="https://docs.copilotkit.ai/coding-agents"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-3 rounded-xl border bg-card p-4 hover:border-accent/40"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent/10 text-accent">
              <BookOpen size={16} aria-hidden />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold text-foreground">
                CopilotKit Coding Agents
              </span>
              <span className="block text-xs text-muted-foreground">
                docs.copilotkit.ai/coding-agents
              </span>
            </span>
            <span
              className="text-muted-foreground group-hover:text-accent"
              aria-hidden
            >
              →
            </span>
          </a>
          <a
            href="https://github.com/CopilotKit/skills"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-3 rounded-xl border bg-card p-4 hover:border-accent/40"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent/10 text-accent">
              <Github size={16} aria-hidden />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold text-foreground">
                CopilotKit Skills repo
              </span>
              <span className="block text-xs text-muted-foreground">
                github.com/CopilotKit/skills
              </span>
            </span>
            <span
              className="text-muted-foreground group-hover:text-accent"
              aria-hidden
            >
              →
            </span>
          </a>
        </div>
      </Section>

      <Section
        id="env"
        eyebrow="Plumbing"
        title="Required keys"
      >
        <ul className="space-y-3">
          <li className="flex items-start gap-3 rounded-xl border bg-card p-4">
            <KeyRound
              size={16}
              className="mt-0.5 shrink-0 text-accent"
              aria-hidden
            />
            <div>
              <p className="text-sm font-semibold text-foreground">
                <Code>GEMINI_API_KEY</Code> &mdash; required
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Set in both <Code>.env</Code> and <Code>agent/.env</Code>.
                Without it the agent boots but every chat turn fails.
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3 rounded-xl border bg-card p-4">
            <KeyRound
              size={16}
              className="mt-0.5 shrink-0 text-accent"
              aria-hidden
            />
            <div>
              <p className="text-sm font-semibold text-foreground">
                <Code>COPILOTKIT_LICENSE_TOKEN</Code> &mdash; issued by the
                CLI
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Or run <Code>npm run license</Code>. Threads silently fail to
                persist without it.
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3 rounded-xl border bg-card p-4">
            <KeyRound
              size={16}
              className="mt-0.5 shrink-0 text-accent"
              aria-hidden
            />
            <div>
              <p className="text-sm font-semibold text-foreground">
                <Code>NOTION_TOKEN</Code> &mdash; required for lead-form demo
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Get a token at{" "}
                <a
                  className="text-accent hover:underline"
                  href="https://notion.so/my-integrations"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  notion.so/my-integrations
                </a>{" "}
                and SHARE the leads database with that integration. Agent
                boots without it but the import will refuse-with-reason.
              </p>
            </div>
          </li>
        </ul>
      </Section>

      <Section id="docs" eyebrow="Reference" title="Documentation">
        <ul className="grid gap-2 md:grid-cols-2">
          {docs.map((d) => (
            <li key={d.href}>
              <a
                href={d.href}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-md border bg-card px-3 py-2 text-sm text-foreground hover:border-accent/40 hover:text-accent"
              >
                {d.label}
              </a>
            </li>
          ))}
        </ul>
      </Section>

        <footer className="mt-16 border-t pt-8 text-sm text-muted-foreground">
          <p>
            Built for the Generative UI · Global Agents · Agentic Interfaces
            hackathon.
          </p>
        </footer>
      </main>
      <AboutToc items={tocItems} />
    </div>
  );
}
