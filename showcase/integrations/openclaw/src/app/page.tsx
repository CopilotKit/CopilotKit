import Link from "next/link";

const demos = [
  {
    route: "/demos/agentic-chat",
    name: "Agentic Chat",
    description: "Streaming chat with an OpenClaw agent via the clawg-ui adapter.",
  },
  {
    route: "/demos/agentic-chat-reasoning",
    name: "Agentic Chat (Reasoning)",
    description: "Reasoning \"stream\" mode — a live reasoning panel beside the answer.",
  },
  {
    route: "/demos/tool-rendering",
    name: "Tool Rendering",
    description: "The agent's server-side tool calls rendered inline as cards.",
  },
  {
    route: "/demos/frontend-tools",
    name: "Frontend Tools",
    description: "A tool defined in React, executed in the browser, invoked by the agent.",
  },
  {
    route: "/demos/prebuilt-sidebar",
    name: "Prebuilt Sidebar",
    description: "The OpenClaw agent in CopilotKit's docked sidebar.",
  },
  {
    route: "/demos/prebuilt-popup",
    name: "Prebuilt Popup",
    description: "The OpenClaw agent in CopilotKit's floating popup widget.",
  },
  {
    route: "/demos/chat-customization-css",
    name: "Chat Customization (CSS)",
    description: "The built-in chat, fully restyled via scoped CSS.",
  },
];

export default function Home() {
  return (
    <main className="max-w-3xl mx-auto p-8">
      <div className="text-xs font-semibold tracking-wider uppercase text-[var(--muted-foreground)] mb-2">
        CopilotKit Showcase
      </div>
      <h1 className="text-3xl font-bold tracking-tight mb-3">OpenClaw</h1>
      <p className="text-[var(--muted-foreground)] leading-relaxed mb-8 max-w-[62ch]">
        CopilotKit driving an OpenClaw agent through the clawg-ui AG-UI adapter
        (operator-auth route, no device pairing).
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {demos.map((d) => (
          <Link
            key={d.route}
            href={d.route}
            className="block rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 no-underline transition-colors hover:border-[var(--ring)]"
          >
            <h2 className="text-base font-semibold mb-1 text-[var(--foreground)]">
              {d.name}
            </h2>
            <p className="text-sm leading-snug text-[var(--muted-foreground)] m-0">
              {d.description}
            </p>
            <div className="mt-3 font-mono text-xs text-[var(--muted-foreground)] opacity-70">
              {d.route}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
