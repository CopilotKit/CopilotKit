import Link from "next/link";
import { getIntegrations, getFeatures, getFeatureCategories } from "@/lib/registry";

const ALL_FRAMEWORKS = [
    "LangGraph", "Mastra", "CrewAI", "PydanticAI", "Agno", "AG2",
    "LlamaIndex", "Langroid", "Strands", "Spring AI", "Google ADK",
];

export default function HomePage() {
    const integrations = getIntegrations();
    const features = getFeatures();
    const categories = getFeatureCategories();

    const deployedIntegrations = integrations.filter((i) => i.deployed);
    const totalDemos = integrations.reduce((sum, i) => sum + i.demos.length, 0);

    const liveFrameworks = new Set(
        ALL_FRAMEWORKS.filter((fw) =>
            integrations.find((i) => i.deployed && (i.name === fw || i.name.startsWith(fw)))
        )
    );

    return (
        <div className="flex flex-col items-center min-h-[calc(100vh-52px)] bg-[var(--bg)] px-6 py-16">
            {/* Hero */}
            <div className="max-w-2xl text-center mb-12">
                <h1 className="text-3xl font-semibold text-[var(--text)] tracking-tight mb-3">
                    Build AI-powered apps with any agent framework
                </h1>
                <p className="text-base text-[var(--text-secondary)] leading-relaxed">
                    Explore live integrations, compare features across frameworks,
                    and find the right starting point for your project.
                </p>
            </div>

            {/* Search bar */}
            <div className="w-full max-w-lg mb-14">
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-sm cursor-pointer hover:border-[var(--text-muted)] transition-colors">
                    <svg
                        className="w-4 h-4 text-[var(--text-muted)] shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                    </svg>
                    <span className="text-sm text-[var(--text-muted)] flex-1">
                        Search integrations, features, demos...
                    </span>
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-[var(--border)] bg-[var(--bg-elevated)] text-[10px] font-mono text-[var(--text-faint)]">
                        ⌘K
                    </kbd>
                </div>
            </div>

            {/* Path cards — 2x2 grid */}
            <div className="w-full max-w-3xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-14">
                <PathCard
                    href="/integrations"
                    title="I know what I want"
                    description="Browse all integrations by framework, language, and feature."
                    icon={
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                        />
                    }
                />
                <PathCard
                    href="/integrations?guided=true"
                    title="Help me choose"
                    description="Answer a few questions and get a tailored recommendation."
                    icon={
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                        />
                    }
                />
                <PathCard
                    href="/matrix"
                    title="Compare everything"
                    description="Side-by-side feature matrix across all frameworks."
                    icon={
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M3 10h18M3 14h18M10 3v18M14 3v18"
                        />
                    }
                />
                <PathCard
                    href="/integrations"
                    title="Quick start"
                    description="Jump straight into a working demo and start building."
                    icon={
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                        />
                    }
                />
                <PathCard
                    href="/docs/learn"
                    title="Learn"
                    description="Tutorials, guides, and step-by-step walkthroughs for building with CopilotKit."
                    icon={
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                        />
                    }
                />
                <PathCard
                    href="/docs"
                    title="Documentation"
                    description="Full guides, integration docs, and troubleshooting."
                    icon={
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                    }
                />
            </div>

            {/* Framework pills */}
            <div className="w-full max-w-2xl mb-14">
                <h2 className="text-[11px] font-mono uppercase tracking-[1.5px] text-[var(--text-faint)] mb-4 text-center">
                    Agent Frameworks
                </h2>
                <div className="flex flex-wrap justify-center gap-2">
                    {ALL_FRAMEWORKS.map((fw) => {
                        const isLive = liveFrameworks.has(fw);
                        const match = isLive
                            ? integrations.find((i) => i.deployed && (i.name === fw || i.name.startsWith(fw)))
                            : undefined;

                        if (isLive && match) {
                            return (
                                <Link
                                    key={fw}
                                    href={`/integrations/${match.slug}`}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                                >
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                                    {fw}
                                </Link>
                            );
                        }

                        return (
                            <span
                                key={fw}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--bg-elevated)] border border-transparent text-[var(--text-faint)] cursor-default"
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-faint)] opacity-40" />
                                {fw}
                            </span>
                        );
                    })}
                </div>
            </div>

            {/* Stats bar */}
            <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                <span className="font-medium text-[var(--text-secondary)]">{deployedIntegrations.length}</span>{" "}
                live integrations
                <span className="text-[var(--border)]">·</span>
                <span className="font-medium text-[var(--text-secondary)]">{totalDemos}</span>{" "}
                demos
                <span className="text-[var(--border)]">·</span>
                <span className="font-medium text-[var(--text-secondary)]">{features.length}</span>{" "}
                features
                <span className="text-[var(--border)]">·</span>
                <span className="font-medium text-[var(--text-secondary)]">{categories.length}</span>{" "}
                categories
            </div>
        </div>
    );
}

function PathCard({
    href,
    title,
    description,
    icon,
}: {
    href: string;
    title: string;
    description: string;
    icon: React.ReactNode;
}) {
    return (
        <Link
            href={href}
            className="group flex flex-col gap-3 p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] hover:shadow-sm transition-all"
        >
            <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">
                <svg
                    className="w-4 h-4 text-[var(--accent)]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    {icon}
                </svg>
            </div>
            <div>
                <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] transition-colors mb-1">
                    {title}
                </h3>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    {description}
                </p>
            </div>
        </Link>
    );
}
/* trigger */
