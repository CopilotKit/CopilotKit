import Link from "next/link";

const CAPABILITIES = [
  {
    id: "rich-threads",
    title: "Rich Threads: conversations and app state",
    body: "A user returns to a report, approval, or conversation. Keep the supported messages, tool results, interactive UI, and state they need to continue. Rich Threads complement your agent framework’s persistence; keep your existing backend.",
    href: "/threads",
    cta: "Start with free Threads",
    note: "Free plan usage and retention limits apply.",
  },
  {
    id: "channels",
    title: "Channels: your agent where work happens",
    body: "An agent is more useful when people can reach it from the tools they already use. Connect your agent to Slack through managed Intelligence connections or a supported direct adapter. Teams has separate availability and setup requirements.",
    href: "/slack",
    cta: "Bring your agent to Slack",
  },
  {
    id: "self-improving-agents",
    title: "Self-Improving Agents & Product Learning",
    body: "Repeated corrections should become useful instructions. Automatic Learning turns supported agent interaction history into insights and proposed Skills. Review the evidence, publish useful Skills, and evaluate the changes in your agent.",
    href: "/solutions/self-improving-agents",
    cta: "Follow a learning workflow",
    note: "Broader learning from interactions throughout your product is a separate demo or early-access conversation.",
  },
  {
    id: "product-analytics",
    title: "Product analytics: understand what happened",
    body: "Inspect captured conversations and available activity, errors, tool usage, token usage, and duration. Use real interactions to decide what to investigate next. Available views depend on captured data and your plan.",
    href: "https://www.copilotkit.ai/copilotkit-intelligence#analytics-insights",
    cta: "Explore product analytics",
  },
  {
    id: "self-hosting",
    title: "Choose where Intelligence runs",
    body: "Managed Cloud stores thread data in the managed service. Self-hosted Intelligence runs with your infrastructure and database. This is a separate deployment choice from self-hosting the open-source frontend and runtime.",
    href: "/intelligence/self-hosting",
    cta: "Compare self-hosted requirements",
  },
] as const;

export function DocsIntelligenceJourney() {
  return (
    <section
      aria-labelledby="intelligence-journey-title"
      className="my-12 scroll-mt-24"
      id="intelligence"
    >
      <h2
        id="intelligence-journey-title"
        className="text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl"
      >
        Add Intelligence when your agent meets real users
      </h2>
      <p className="mt-4 max-w-[70ch] text-base leading-7 text-[var(--text-secondary)]">
        CopilotKit’s open-source framework connects your agent to the UI.
        CopilotKit Intelligence adds persistent conversations, inspection,
        learning, and channels around that interaction. Start with one
        capability and keep your agent stack.
      </p>
      <div className="mt-6 divide-y divide-[var(--border)] border-y border-[var(--border)]">
        {CAPABILITIES.map((capability) => (
          <section
            key={capability.id}
            id={capability.id}
            aria-labelledby={`${capability.id}-title`}
            className="scroll-mt-24 py-6 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.65fr)] sm:gap-8"
          >
            <h3
              id={`${capability.id}-title`}
              className="text-lg font-semibold leading-7 text-[var(--text)]"
            >
              {capability.title}
            </h3>
            <div>
              <p className="mt-2 text-sm leading-7 text-[var(--text-secondary)] sm:mt-0">
                {capability.body}
              </p>
              {"note" in capability && (
                <p className="mt-2 text-xs leading-6 text-[var(--text-muted)]">
                  {capability.note}
                </p>
              )}
              <Link
                href={capability.href}
                className="mt-3 inline-block text-sm font-semibold text-[var(--accent)] underline underline-offset-4"
              >
                {capability.cta} →
              </Link>
            </div>
          </section>
        ))}
      </div>
      <p
        id="share-with-your-team"
        className="mt-5 text-sm leading-7 text-[var(--text-secondary)]"
      >
        Evaluating with a product lead?{" "}
        <Link
          href="https://www.copilotkit.ai/copilotkit-intelligence/product-brief"
          className="font-semibold text-[var(--accent)] underline underline-offset-4"
        >
          Share the one-page overview and PDF
        </Link>
        .
      </p>
    </section>
  );
}
