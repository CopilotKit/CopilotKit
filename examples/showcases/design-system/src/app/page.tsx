import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";

const PATTERNS = [
  {
    href: "/chat-ui",
    eyebrow: "01 · CHAT UI",
    title: "Make the chat look like your product",
    blurb:
      "Three ways to skin CopilotKit's chat — pass CSS classes, replace one piece, or build the whole chat yourself.",
    bullets: [
      "Style with CSS classes — fastest",
      "Replace a single piece of the chat",
      "Headless — write the chat from scratch",
    ],
  },
  {
    href: "/controlled",
    eyebrow: "02 · CONTROLLED",
    title: "Your component, agent fills the props",
    blurb:
      "The most common pattern. You pre-build a component, the agent decides when to show it and what data to pass.",
    bullets: [
      "Render the component inside the chat (useComponent)",
      "Or pin it to a side panel of your app (useFrontendTool)",
      "Works with any React component you already have",
    ],
  },
  {
    href: "/declarative",
    eyebrow: "03 · DECLARATIVE",
    title: "Catalog of building blocks, agent composes",
    blurb:
      "Hand the agent a catalog of your design-system components. The agent picks and arranges them per question. Layouts vary, look stays consistent.",
    bullets: [
      "One catalog, many layouts",
      "Renders in chat or in a side panel",
      "Same components in both places",
    ],
  },
  {
    href: "/open",
    eyebrow: "04 · OPEN ENDED",
    title: "Agent generates the UI itself",
    blurb:
      "Two flavors. Open Gen UI lets the agent stream raw HTML/CSS/JS into a sandbox. MCP Apps lets a server expose tools whose UI renders automatically. Best for one-off views, not production flows.",
    bullets: [
      "Open Gen UI — agent writes the markup",
      "MCP Apps — UI comes from an external server",
      "Both render in the chat, sandboxed",
    ],
  },
];

export default function Home() {
  return (
    <>
      <SiteNav />

      <section className="border-b border-[var(--line)]">
        <div className="max-w-[1480px] mx-auto px-5 py-12 md:py-16">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
            Tutorial · CopilotKit
          </span>
          <h1 className="font-display text-[36px] md:text-[44px] font-semibold tracking-tight leading-[1.1] text-[var(--ink)] mt-3 max-w-[760px]">
            Designing agents with your own design system.
          </h1>
          <p className="mt-4 text-[15px] md:text-[16px] text-[var(--ink-2)] leading-relaxed max-w-[680px]">
            Most user interaction with your product will run through agents.
            That UI has to respect your brand, your design system, and the
            components your team already ships. CopilotKit gives you four
            patterns to do that, from a CSS-only reskin of the chat to a
            full catalog-driven generative UI.
          </p>
          <p className="mt-4 text-[14px] text-[var(--muted)] leading-relaxed max-w-[680px]">
            Each page shows a working example. The Chat UI page also shows
            the same chat in two design systems so you can see what
            customization buys you.
          </p>
        </div>
      </section>

      <main className="flex-1 max-w-[1480px] mx-auto px-5 py-10 w-full">
        <div className="grid md:grid-cols-2 gap-5">
          {PATTERNS.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="surface p-6 transition hover:border-[var(--ink-2)] flex flex-col gap-4"
            >
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--muted)]">
                {p.eyebrow}
              </span>
              <h2 className="font-display text-[22px] font-semibold tracking-tight text-[var(--ink)] leading-tight">
                {p.title}
              </h2>
              <p className="text-[14px] text-[var(--ink-2)] leading-relaxed">
                {p.blurb}
              </p>
              <ul className="flex flex-col gap-1.5 mt-1">
                {p.bullets.map((b) => (
                  <li
                    key={b}
                    className="flex items-start gap-2 text-[13px] text-[var(--muted)] leading-relaxed"
                  >
                    <span className="mt-[7px] w-1 h-1 rounded-full bg-[var(--accent)] flex-none" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <span className="mt-auto inline-flex items-center gap-1.5 pt-2 font-mono text-[11px] uppercase tracking-wider text-[var(--ink)]">
                Open <span aria-hidden>→</span>
              </span>
            </Link>
          ))}
        </div>
      </main>

      <footer className="border-t border-[var(--line)] py-6">
        <div className="max-w-[1480px] mx-auto px-5 text-[12px] text-[var(--muted)] flex items-center justify-between">
          <span>
            React-focused. The same patterns extend to other web frameworks,
            mobile, Slack, and Microsoft Teams.
          </span>
          <span className="font-mono">v0.1</span>
        </div>
      </footer>
    </>
  );
}
