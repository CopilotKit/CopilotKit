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

export function LandingSampleTabs() {
  const [activeId, setActiveId] = React.useState(SAMPLE_TABS[0].id);
  const activeTab =
    SAMPLE_TABS.find((tab) => tab.id === activeId) ?? SAMPLE_TABS[0];

  return (
    <section className="not-prose space-y-5">
      <div className="max-w-2xl">
        <h2 className="text-xl font-semibold text-[var(--text)] sm:text-2xl">
          Build your agent&apos;s user experience
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
          Pick the UI primitive that matches the product surface you are
          building.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-[0_18px_44px_-32px_rgba(1,5,7,0.22)]">
        <div className="flex h-10 items-center justify-between border-b border-[var(--border)] bg-[var(--bg-elevated)] px-4">
          <div className="flex items-center gap-2" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="hidden font-mono text-xs text-[var(--text-muted)] sm:block">
            Preview
          </div>
          <div className="h-2.5 w-[46px]" aria-hidden="true" />
        </div>

        <div className="grid lg:min-h-[460px] lg:grid-cols-[250px_minmax(0,1fr)]">
          <div className="border-b border-[var(--border)] bg-[var(--bg-elevated)]/60 p-3 lg:border-b-0 lg:border-r">
            <div
              aria-label="CopilotKit samples"
              className="grid w-full gap-1 sm:grid-cols-2 lg:grid-cols-1"
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
                      "group flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      selected
                        ? "border-[var(--accent)] bg-[var(--bg-surface)] text-[var(--text)] shadow-[0_1px_2px_rgba(1,5,7,0.05)]"
                        : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/70 hover:text-[var(--text)]",
                    )}
                    role="tab"
                    onClick={() => setActiveId(tab.id)}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
                          : "border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] group-hover:text-[var(--accent)]",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[0.8125rem] font-medium leading-none tracking-[-0.005em]">
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
            className="flex min-h-[540px] flex-col gap-5 p-5 sm:min-h-[440px] lg:p-6"
            role="tabpanel"
          >
            <div className="max-w-2xl">
              <h3 className="text-xl font-semibold leading-tight text-[var(--text)]">
                {activeTab.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
                {activeTab.description}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
              <div className="flex h-9 items-center justify-between border-b border-[var(--border)] bg-[var(--bg-elevated)] px-3">
                <span className="font-mono text-xs text-[var(--text-muted)]">
                  example.tsx
                </span>
                <span className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-muted)]">
                  tsx
                </span>
              </div>
              <div className="h-[360px] overflow-auto sm:h-[300px] [&_figure]:my-0 [&_figure]:border-0 [&_pre]:min-h-full [&_pre]:rounded-none [&_pre]:border-0">
                <DynamicCodeBlock lang="tsx" code={activeTab.code ?? ""} />
              </div>
            </div>

            <div className="flex justify-end">
              <div className="max-w-2xl">
                <Link
                  href={activeTab.href}
                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--accent-dim)] px-3 text-sm font-semibold text-[var(--accent)] no-underline transition-colors hover:bg-[var(--accent-light)]"
                >
                  {activeTab.hrefLabel}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
