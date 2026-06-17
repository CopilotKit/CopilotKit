"use client";

import React from "react";
import Link from "next/link";
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { Bot, Code2, MessagesSquare, Paintbrush } from "lucide-react";

type SampleTab = {
  id: string;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  hrefLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  code?: string;
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const SAMPLE_TABS: SampleTab[] = [
  {
    id: "chat-components",
    label: "Chat components",
    eyebrow: "Prebuilt UI",
    title: "Drop in a chat surface where your users already work.",
    description:
      "Use CopilotChat, CopilotSidebar, or CopilotPopup when you want a complete agent UI out of the box.",
    href: "/prebuilt-components/chat",
    hrefLabel: "View chat components",
    icon: MessagesSquare,
    code: `import { CopilotChat } from "@copilotkit/react-core/v2";

export function SupportAssistant() {
  return (
    <CopilotChat
      labels={{
        modalHeaderTitle: "Product assistant",
        welcomeMessageText: "What should we work on?",
      }}
    />
  );
}`,
  },
  {
    id: "headless-ui",
    label: "Headless UI",
    eyebrow: "Custom surfaces",
    title: "Own every pixel and still use the agent runtime.",
    description:
      "Headless hooks let you build custom chat, command palettes, canvas controls, and inline assistants.",
    href: "/custom-look-and-feel/headless-ui",
    hrefLabel: "View headless UI",
    icon: Code2,
    code: `import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { randomUUID } from "@copilotkit/shared/v2";

export function CustomComposer() {
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();

  async function sendMessage(content: string) {
    agent.addMessage({
      id: randomUUID(),
      role: "user",
      content,
    });

    await copilotkit.runAgent({ agent });
  }

  return <Composer onSend={sendMessage} />;
}`,
  },
  {
    id: "any-agent",
    label: "Any agent",
    eyebrow: "AG-UI runtime",
    title: "Connect any backend that speaks AG-UI.",
    description:
      "Define agents in CopilotRuntime and stream standard AG-UI events back to your React app.",
    href: "/agentic-protocols/ag-ui",
    hrefLabel: "View AG-UI",
    icon: Bot,
    code: `import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { NextRequest } from "next/server";

const runtime = new CopilotRuntime({
  agents: {
    my_agent: new HttpAgent({
      url: "http://localhost:8000/",
    }),
  },
});

const serviceAdapter = new ExperimentalEmptyAdapter();

export async function POST(req: NextRequest) {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
}`,
  },
  {
    id: "generative-ui",
    label: "Generative UI",
    eyebrow: "useComponent",
    title: "Let agents render real React components.",
    description:
      "Register components as frontend tools so the agent can show cards, forms, approvals, and rich app states.",
    href: "/reference/hooks/useComponent",
    hrefLabel: "View useComponent",
    icon: Paintbrush,
    code: `import { useComponent } from "@copilotkit/react-core/v2";
import { z } from "zod";

const weatherCardSchema = z.object({
  city: z.string().describe("City name"),
  unit: z.enum(["c", "f"]).default("c"),
});

function WeatherCard(props: z.infer<typeof weatherCardSchema>) {
  return <ForecastCard city={props.city} unit={props.unit} />;
}

export function App() {
  useComponent(
    {
      name: "showWeatherCard",
      description: "Render a forecast card in chat.",
      parameters: weatherCardSchema,
      render: WeatherCard,
    },
    [],
  );

  return null;
}`,
  },
];

function findSampleTab(id: string) {
  const tab = SAMPLE_TABS.find((sample) => sample.id === id);
  if (!tab) {
    throw new Error(`Unknown landing sample tab: ${id}`);
  }
  return tab;
}

const MOBILE_SAMPLE_TABS = [
  findSampleTab("chat-components"),
  findSampleTab("headless-ui"),
  findSampleTab("generative-ui"),
  findSampleTab("any-agent"),
];

export function LandingSampleTabs() {
  const [activeId, setActiveId] = React.useState(SAMPLE_TABS[0].id);
  const activeTab =
    SAMPLE_TABS.find((tab) => tab.id === activeId) ?? SAMPLE_TABS[0];

  return (
    <section className="not-prose space-y-4 sm:space-y-5">
      <div className="max-w-2xl">
        <h2 className="text-xl font-semibold text-[var(--text)] sm:text-2xl">
          Build your agent&apos;s user experience
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
          Pick the UI primitive that matches the product surface you are
          building.
        </p>
      </div>

      <div
        aria-label="CopilotKit mobile samples"
        className="grid gap-2 sm:hidden"
      >
        {MOBILE_SAMPLE_TABS.map((tab) => {
          const Icon = tab.icon;

          return (
            <Link
              key={tab.id}
              href={tab.href}
              data-mobile-sample-card={tab.id}
              className="shell-docs-radius-surface group flex min-w-0 items-start gap-3 border border-[var(--border)] bg-[var(--bg-surface)] p-3.5 no-underline shadow-[var(--shadow-control)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)]"
            >
              <span
                aria-hidden="true"
                className="shell-docs-radius-icon flex h-9 w-9 shrink-0 items-center justify-center border border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-snug text-[var(--text)]">
                  {tab.label}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-[var(--text-muted)]">
                  {tab.title}
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      <div className="shell-docs-radius-surface hidden min-w-0 overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-control)] sm:block">
        <div className="flex h-10 items-center justify-between border-b border-[var(--border)] bg-[var(--bg-elevated)] px-4">
          <div className="flex items-center gap-2" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--window-control-close)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--window-control-minimize)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--window-control-zoom)]" />
          </div>
          <div className="hidden font-mono text-xs text-[var(--text-muted)] sm:block">
            Preview
          </div>
          <div className="h-2.5 w-[46px]" aria-hidden="true" />
        </div>

        <div className="grid min-w-0 lg:min-h-[460px] lg:grid-cols-[250px_minmax(0,1fr)]">
          <div className="min-w-0 border-b border-[var(--border)] bg-[var(--bg-elevated)]/60 p-2 sm:p-3 lg:border-b-0 lg:border-r">
            <div
              aria-label="CopilotKit samples"
              className="grid w-full grid-cols-2 gap-1.5 lg:grid-cols-1"
              role="tablist"
            >
              {SAMPLE_TABS.map((tab) => {
                const Icon = tab.icon;
                const selected = tab.id === activeTab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    id={`landing-sample-tab-${tab.id}`}
                    aria-label={tab.label}
                    aria-controls={`landing-sample-panel-${tab.id}`}
                    aria-selected={selected}
                    className={cn(
                      "shell-docs-radius-control group flex min-h-11 min-w-[9.75rem] items-center gap-2 border px-2.5 py-2 text-left transition-colors sm:min-h-14 sm:min-w-0 sm:gap-3 sm:px-3 sm:py-2.5",
                      selected
                        ? "border-[var(--accent)] bg-[var(--bg-surface)] text-[var(--text)] shadow-[var(--shadow-control)]"
                        : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/70 hover:text-[var(--text)]",
                    )}
                    role="tab"
                    onClick={() => setActiveId(tab.id)}
                  >
                    <span
                      className={cn(
                        "shell-docs-radius-icon flex h-7 w-7 shrink-0 items-center justify-center border transition-colors sm:h-8 sm:w-8",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
                          : "border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] group-hover:text-[var(--accent)]",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[0.8125rem] font-medium leading-tight tracking-[-0.005em]">
                        {tab.label}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div
            id={`landing-sample-panel-${activeTab.id}`}
            aria-labelledby={`landing-sample-tab-${activeTab.id}`}
            className="flex min-h-0 min-w-0 flex-col gap-3 p-4 sm:min-h-[440px] sm:gap-5 sm:p-5 lg:p-6"
            role="tabpanel"
          >
            <div className="max-w-2xl">
              <h3 className="text-[1.0625rem] font-semibold leading-tight text-[var(--text)] sm:text-xl">
                {activeTab.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
                {activeTab.description}
              </p>
            </div>

            <div className="shell-docs-radius-surface min-h-0 min-w-0 flex-1 overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)]">
              <div className="flex h-9 items-center justify-between border-b border-[var(--border)] bg-[var(--bg-elevated)] px-3">
                <span className="font-mono text-xs text-[var(--text-muted)]">
                  example.tsx
                </span>
                <span className="shell-docs-radius-control bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-muted)]">
                  tsx
                </span>
              </div>
              <div className="h-[260px] min-w-0 overflow-auto sm:h-[300px] [&_figure]:my-0 [&_figure]:min-w-0 [&_figure]:border-0 [&_pre]:min-h-full [&_pre]:rounded-none [&_pre]:border-0">
                <DynamicCodeBlock lang="tsx" code={activeTab.code ?? ""} />
              </div>
            </div>

            <div className="flex justify-stretch sm:justify-end">
              <Link
                href={activeTab.href}
                className="shell-docs-radius-control inline-flex h-9 w-full shrink-0 items-center justify-center border border-[var(--accent)] bg-[var(--accent-dim)] px-3 text-sm font-semibold text-[var(--accent)] no-underline transition-colors hover:bg-[var(--accent-light)] sm:w-auto"
              >
                {activeTab.hrefLabel}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
