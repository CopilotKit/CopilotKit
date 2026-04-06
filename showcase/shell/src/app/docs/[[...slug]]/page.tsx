import fs from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import Link from "next/link";
import { Callout, Cards, Card, Accordions, Accordion } from "@/components/mdx-components";
import { PropertyReference } from "@/components/property-reference";

const CONTENT_DIR = path.join(process.cwd(), "src/content/docs");
// Resolve snippets relative to CONTENT_DIR (which is known to work for filesystem reads)
const SNIPPETS_DIR = path.join(CONTENT_DIR, "..", "snippets");

// Map component tags to snippet file paths (relative to SNIPPETS_DIR).
// When an MDX page contains only a single component tag like <CopilotRuntime />,
// we replace it with the snippet's actual content so the page renders properly.
const SNIPPET_MAP: Record<string, string> = {
    "A2UI": "shared/generative-ui/a2ui.mdx",
    "AgUI": "shared/backend/ag-ui.mdx",
    "AGUI": "shared/backend/ag-ui.mdx",
    "CodingAgents": "shared/coding-agents.mdx",
    "CommonIssues": "shared/troubleshooting/common-issues.mdx",
    "CopilotRuntime": "copilot-runtime.mdx",
    "DisplayOnly": "shared/generative-ui/display-only.mdx",
    "ErrorDebugging": "shared/troubleshooting/error-debugging.mdx",
    "FrontendTools": "shared/app-control/frontend-tools.mdx",
    "FrontEndToolsImpl": "shared/app-control/frontend-tools.mdx",
    "GenerativeUISpecsOverview": "shared/generative-ui-specs-overview.mdx",
    "HeadlessUI": "shared/basics/headless-ui.mdx",
    "Inspector": "shared/premium/inspector.mdx",
    "Interactive": "shared/generative-ui/interactive.mdx",
    "MCPApps": "shared/generative-ui/mcp-apps.mdx",
    "MCPSetup": "shared/guides/mcp-server-setup.mdx",
    "MigrateTo1100": "shared/troubleshooting/migrate-to-1.10.X.mdx",
    "MigrateTo182": "shared/troubleshooting/migrate-to-1.8.2.mdx",
    "MigrateToV2": "shared/troubleshooting/migrate-to-v2.mdx",
    "Observability": "shared/premium/observability.mdx",
    "ObservabilityConnectors": "shared/troubleshooting/observability-connectors.mdx",
    "Overview": "shared/premium/overview.mdx",
    "PrebuiltComponents": "shared/basics/prebuilt-components.mdx",
    "ProgrammaticControl": "shared/basics/programmatic-control.mdx",
    "ReasoningMessages": "shared/guides/custom-look-and-feel/reasoning-messages.mdx",
    "Slots": "shared/basics/slots.mdx",
    "ToolRendering": "shared/generative-ui/tool-rendering.mdx",
    "DefaultToolRendering": "shared/guides/default-tool-rendering.mdx",
};

// Map page sub-paths to snippet component names for <SharedContent /> resolution.
// Integration pages like integrations/langgraph/coding-agents.mdx use <SharedContent />
// to render the same content as the top-level coding-agents page.
const SUBPATH_TO_COMPONENT: Record<string, string> = {
    "ag-ui": "AGUI",
    "coding-agents": "CodingAgents",
    "copilot-runtime": "CopilotRuntime",
    "custom-look-and-feel/headless-ui": "HeadlessUI",
    "custom-look-and-feel/slots": "Slots",
    "frontend-tools": "FrontendTools",
    "generative-ui/a2ui": "A2UI",
    "generative-ui/mcp-apps": "MCPApps",
    "generative-ui/tool-rendering": "ToolRendering",
    "generative-ui/your-components/display-only": "DisplayOnly",
    "generative-ui/your-components/interactive": "Interactive",
    "inspector": "Inspector",
    "prebuilt-components": "PrebuiltComponents",
    "programmatic-control": "ProgrammaticControl",
    "premium/headless-ui": "HeadlessUI",
    "premium/observability": "Observability",
    "premium/overview": "Overview",
    "troubleshooting/common-issues": "CommonIssues",
    "troubleshooting/error-debugging": "ErrorDebugging",
    "troubleshooting/migrate-to-1.10.X": "MigrateTo1100",
    "troubleshooting/migrate-to-1.8.2": "MigrateTo182",
    "troubleshooting/migrate-to-v2": "MigrateToV2",
    "troubleshooting/observability-connectors": "ObservabilityConnectors",
};

// Replace component tags (e.g. <CopilotRuntime />) with their snippet content.
// Handles both single-component pages and tags embedded in mixed content.
// slugPath is used to resolve <SharedContent /> in integration pages.
function inlineSnippets(content: string, slugPath: string = ""): string {
    // Strip import statements first
    let result = content.replace(/^import\s+.+$/gm, "");

    // Replace all self-closing component tags that have snippet mappings
    // Matches: <ComponentName /> or <ComponentName components={props.components} />
    result = result.replace(
        /<([A-Z]\w*)\s*(?:components=\{[^}]*\}\s*)?\/>/g,
        (match, componentName) => {
            let snippetRel = SNIPPET_MAP[componentName];

            // For <SharedContent />, resolve based on the page's sub-path
            if (!snippetRel && componentName === "SharedContent" && slugPath) {
                // Extract sub-path: integrations/<framework>/<subpath> → <subpath>
                const subPathMatch = slugPath.match(/^integrations\/[^/]+\/(.+)$/);
                if (subPathMatch) {
                    const resolvedComponent = SUBPATH_TO_COMPONENT[subPathMatch[1]];
                    if (resolvedComponent) {
                        snippetRel = SNIPPET_MAP[resolvedComponent];
                    }
                }
            }

            if (!snippetRel) return match; // Keep unknown components as-is
            const snippetPath = path.join(SNIPPETS_DIR, snippetRel);
            if (!fs.existsSync(snippetPath)) {
                console.warn(`[docs] Snippet file not found: ${snippetPath}`);
                return match;
            }
            let snippetContent = fs.readFileSync(snippetPath, "utf-8");
            snippetContent = snippetContent.replace(/^---[\s\S]*?---\n?/, "");
            snippetContent = snippetContent.replace(/^import\s+.+$/gm, "");
            // Recursively inline nested component delegates
            return inlineSnippets(snippetContent, slugPath);
        }
    );

    return result;
}

function getNavItems(): { section: string; items: { slug: string; title: string }[] }[] {
    const sections: Record<string, { slug: string; title: string }[]> = {};

    function walk(dir: string, prefix: string = "") {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || entry.name.startsWith("(")) continue;
            if (entry.isDirectory()) {
                walk(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
            } else if (entry.name.endsWith(".mdx")) {
                const slug = prefix
                    ? `${prefix}/${entry.name.replace(".mdx", "")}`
                    : entry.name.replace(".mdx", "");
                const raw = fs.readFileSync(path.join(dir, entry.name), "utf-8");
                const titleMatch = raw.match(/title:\s*["']?(.+?)["']?\s*$/m) || raw.match(/^#\s+(.+)$/m);
                const title = titleMatch?.[1] || entry.name.replace(".mdx", "").replace(/-/g, " ");
                const section = prefix.split("/")[0] || "Guides";
                const sectionLabel = section.charAt(0).toUpperCase() + section.slice(1).replace(/-/g, " ");
                if (!sections[sectionLabel]) sections[sectionLabel] = [];
                sections[sectionLabel].push({ slug, title });
            }
        }
    }

    walk(CONTENT_DIR);
    return Object.entries(sections)
        .filter(([, items]) => items.length > 0)
        .map(([section, items]) => ({ section, items: items.slice(0, 20) }));
}

const components = {
    Callout, Cards, Card, Accordions, Accordion, PropertyReference,
    Note: Callout,
    Warning: ({ children }: { children: React.ReactNode }) => <Callout type="warn">{children}</Callout>,
    Tip: ({ children }: { children: React.ReactNode }) => <Callout type="info">{children}</Callout>,
    Steps: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Step: ({ children, title }: { children: React.ReactNode; title?: string }) => (
        <div style={{ marginBottom: "1rem" }}>
            {title && <h4 style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{title}</h4>}
            {children}
        </div>
    ),
    CardGroup: Cards,
    Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Tab: ({ children, title }: { children: React.ReactNode; title?: string }) => (
        <div style={{ marginBottom: "1rem" }}>
            {title && <div style={{ fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.5rem", color: "var(--text-secondary)" }}>{title}</div>}
            {children}
        </div>
    ),
    Frame: ({ children }: { children: React.ReactNode }) => <div style={{ border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "1rem", marginBottom: "1rem" }}>{children}</div>,
    // Fumadocs-specific components we shim
    IntegrationGrid: ({ path }: { path?: string }) => <div style={{ padding: "1rem", background: "var(--bg-elevated)", borderRadius: "0.5rem", marginBottom: "1rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>See <a href="/integrations" style={{ color: "var(--accent)" }}>Integrations</a> for all available frameworks{path ? ` (${path})` : ""}.</div>,
    FeatureGrid: ({ children }: { children?: React.ReactNode }) => <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.75rem" }}>{children}</div>,
    Feature: ({ children, title }: { children?: React.ReactNode; title?: string }) => <div style={{ border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "1rem" }}>{title && <h4 style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{title}</h4>}{children}</div>,
    video: (props: Record<string, unknown>) => <video {...props} className={undefined} style={{ borderRadius: "0.5rem", width: "100%", marginBottom: "1rem" }} />,
    img: (props: Record<string, unknown>) => <img {...props} className={undefined} style={{ borderRadius: "0.5rem", maxWidth: "100%", marginBottom: "1rem" }} />,
    CodeGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Snippet: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Info: Callout,
    Caution: ({ children }: { children: React.ReactNode }) => <Callout type="warn">{children}</Callout>,
    // Passthrough components — render children as-is
    TailoredContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    TailoredContentOption: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SharedContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    IframeSwitcher: ({ children, src }: { children?: React.ReactNode; src?: string }) => src ? <div style={{ border: "1px solid var(--border)", borderRadius: "0.5rem", overflow: "hidden", marginBottom: "1rem" }}><iframe src={src} style={{ width: "100%", height: "400px", border: "none" }} /></div> : <div>{children}</div>,
    IframeSwitcherGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    RunAndConnect: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    RunAndConnectSnippet: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    MigrateTo: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    MigrateToV: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    HeadlessUI: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ImageZoom: ({ src, alt }: { src?: string; alt?: string }) => <img src={src} alt={alt || ""} style={{ borderRadius: "0.5rem", maxWidth: "100%", marginBottom: "1rem", cursor: "zoom-in" }} />,
    InstallSDKSnippet: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    MCPApps: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    MCPSetup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Overview: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    FrameworkOverview: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    CommonIssues: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ErrorDebugging: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Observability: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ObservabilityConnectors: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Inspector: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    DefaultToolRendering: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    DisplayOnly: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Interactive: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    PrebuiltComponents: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ProgrammaticControl: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    CodingAgents: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Slots: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    FrontendTools: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    FrontEndToolsImpl: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ToolRendering: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ToolRenderer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ReasoningMessages: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    // Styled components
    YouTubeVideo: ({ id }: { id?: string }) => id ? <div style={{ position: "relative", paddingBottom: "56.25%", marginBottom: "1rem" }}><iframe src={`https://www.youtube.com/embed/${id}`} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none", borderRadius: "0.5rem" }} allowFullScreen /></div> : null,
    CTACards: ({ children }: { children?: React.ReactNode }) => <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>{children}</div>,
    AttributeCards: ({ children }: { children?: React.ReactNode }) => <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>{children}</div>,
    PatternCard: ({ children, title }: { children?: React.ReactNode; title?: string }) => <div style={{ border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "1rem", marginBottom: "0.75rem" }}>{title && <h4 style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{title}</h4>}{children}</div>,
    TwoColumnSection: ({ children }: { children: React.ReactNode }) => <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1rem" }}>{children}</div>,
    EcosystemTable: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    FeatureMatrix: () => <div style={{ padding: "1rem", background: "var(--bg-elevated)", borderRadius: "0.5rem", marginBottom: "1rem" }}>See the <a href="/matrix" style={{ color: "var(--accent)" }}>Feature Matrix</a> for a full comparison.</div>,
    IntegrationsGrid: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    IntegrationButtonGroup: ({ children }: { children?: React.ReactNode }) => <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>{children}</div>,
    // Misc
    AGUI: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    AgUI: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    SignUpSection: () => <div style={{ padding: "1rem", background: "var(--bg-elevated)", borderRadius: "0.5rem", marginBottom: "1rem" }}><a href="https://cloud.copilotkit.ai" style={{ color: "var(--accent)" }}>Sign up for CopilotKit Cloud →</a></div>,
    LinkToCopilotCloud: () => <a href="https://cloud.copilotkit.ai" style={{ color: "var(--accent)" }}>CopilotKit Cloud</a>,
    LandingCodeShowcase: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    UseAgentSnippet: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    InstallPythonSDK: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ActionButtons: ({ children }: { children?: React.ReactNode }) => <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>{children}</div>,
    ApproveComponent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    AskComponent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    CopilotCloudConfigureCopilotKitProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    GenerativeUISpecsOverview: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    IOptions: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    JsonOptions: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    MessageActionRenderProps: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    CopilotRuntime: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    // HTML/React elements that MDX tries to resolve as components
    Image: ({ src, alt, ...props }: Record<string, unknown>) => <img src={src as string} alt={(alt as string) || ""} style={{ borderRadius: "0.5rem", maxWidth: "100%", marginBottom: "1rem" }} />,
    A: ({ children, href, ...props }: { children?: React.ReactNode; href?: string }) => <a href={href} style={{ color: "var(--accent)" }}>{children}</a>,
    Button: ({ children, ...props }: { children?: React.ReactNode }) => <button style={{ padding: "0.5rem 1rem", borderRadius: "0.375rem", border: "1px solid var(--border)", background: "var(--bg-surface)", cursor: "pointer" }}>{children}</button>,
    Link: ({ children, href }: { children?: React.ReactNode; href?: string }) => <a href={href} style={{ color: "var(--accent)" }}>{children}</a>,
    Code: ({ children }: { children?: React.ReactNode }) => <code>{children}</code>,
    Progress: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    // Lucide icons — render as empty spans (they're decorative)
    Wrench: () => <span>🔧</span>,
    WrenchIcon: () => <span>🔧</span>,
    PaintbrushIcon: () => <span>🎨</span>,
    UserIcon: () => <span>👤</span>,
    RepeatIcon: () => <span>🔄</span>,
    Book: () => <span>📖</span>,
    BookOpen: () => <span>📖</span>,
    BookA: () => <span>📖</span>,
    Bot: () => <span>🤖</span>,
    Cpu: () => <span>💻</span>,
    CpuIcon: () => <span>💻</span>,
    Database: () => <span>🗄️</span>,
    FileSpreadsheet: () => <span>📊</span>,
    Layers: () => <span>📚</span>,
    MessageCircle: () => <span>💬</span>,
    MessageSquare: () => <span>💬</span>,
    MonitorIcon: () => <span>🖥️</span>,
    Plane: () => <span>✈️</span>,
    Play: () => <span>▶️</span>,
    Plug: () => <span>🔌</span>,
    PlugIcon: () => <span>🔌</span>,
    Settings: () => <span>⚙️</span>,
    Sparkles: () => <span>✨</span>,
    SquareChartGantt: () => <span>📊</span>,
    SquareTerminal: () => <span>💻</span>,
    Trash: () => <span>🗑️</span>,
    Zap: () => <span>⚡</span>,
    X: () => <span>✕</span>,
    Cog: () => <span>⚙️</span>,
    Server: () => <span>🖥️</span>,
    ArrowLeftRight: () => <span>↔️</span>,
    Banknote: () => <span>💰</span>,
    AlertCircle: () => <span>⚠️</span>,
    PiMonitor: () => <span>🖥️</span>,
    // Framework icons
    AwsStrandsIcon: () => <span>☁️</span>,
    MicrosoftIcon: () => <span>Ⓜ️</span>,
    PydanticAIIcon: () => <span>🐍</span>,
    SiLangchain: () => <span>🔗</span>,
    // FontAwesome icons
    FaArrowUp: () => <span>↑</span>,
    FaCloud: () => <span>☁️</span>,
    FaGithub: () => <span>⌨️</span>,
    FaServer: () => <span>🖥️</span>,
    FaWrench: () => <span>🔧</span>,
    // Code example components (render children or nothing)
    CopilotKit: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    CopilotChat: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    CopilotSidebar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    CopilotPopup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    CopilotTextarea: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    CopilotKitProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    CopilotUI: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    CloudCopilotKitProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    SelfHostingCopilotRuntimeCreateEndpoint: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    SelfHostingCopilotRuntimeConfigureCopilotKitProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    AgentState: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    AgentStateSnapshot: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    AgentRunResponseUpdate: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    // Chart components
    Bar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    BarChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    XAxis: () => null,
    YAxis: () => null,
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Tooltip: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    TooltipProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Markdown: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    // App-specific components from code examples
    Chat: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Task: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    TasksList: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    TasksProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    MapCanvas: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Email: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    EmailsProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    EmailThread: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ChatMessage: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    MessageFromA: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    MessageToA: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Reply: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    PlaceCard: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Proposal: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ProposalViewer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    TripsProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ResearchProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ResearchContext: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ResearchContextType: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ResearchState: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    SearchInfo: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    SearchProgress: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    YourApp: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    YourMainContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    MCPClient: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    McpServerManager: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    McpToolCall: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    GoServer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
};

function DocsOverview() {
    return (
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
            <h1 className="text-3xl font-semibold text-[var(--text)] tracking-tight mb-3">
                CopilotKit Documentation
            </h1>
            <p className="text-base text-[var(--text-secondary)] leading-relaxed mb-10">
                Guides, tutorials, and integration documentation for building
                AI-powered applications with CopilotKit.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left mb-10">
                <Link href="/docs/agentic-chat-ui" className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all">
                    <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">Agentic Chat UI</h3>
                    <p className="text-xs text-[var(--text-muted)]">Build chat interfaces with CopilotKit components</p>
                </Link>
                <Link href="/docs/frontend-tools" className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all">
                    <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">Frontend Tools</h3>
                    <p className="text-xs text-[var(--text-muted)]">Define tools your agent can call on the frontend</p>
                </Link>
                <Link href="/docs/generative-ui" className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all">
                    <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">Generative UI</h3>
                    <p className="text-xs text-[var(--text-muted)]">Let your agent generate interactive UI components</p>
                </Link>
                <Link href="/docs/backend/copilot-runtime" className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all">
                    <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">Copilot Runtime</h3>
                    <p className="text-xs text-[var(--text-muted)]">Server-side runtime for connecting agents</p>
                </Link>
                <Link href="/docs/integrations" className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all">
                    <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">Integrations</h3>
                    <p className="text-xs text-[var(--text-muted)]">LangGraph, Mastra, CrewAI, and more</p>
                </Link>
                <Link href="/docs/learn" className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all">
                    <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">Learn</h3>
                    <p className="text-xs text-[var(--text-muted)]">Tutorials and learning resources</p>
                </Link>
            </div>

            <p className="text-xs text-[var(--text-faint)]">
                517 pages · Guides · Integrations · Tutorials · Troubleshooting
            </p>
        </div>
    );
}

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
    const { slug } = await params;

    // Overview page when no slug
    if (!slug || slug.length === 0) {
        return <DocsOverview />;
    }

    const slugPath = slug.join("/");
    let filePath = path.join(CONTENT_DIR, `${slugPath}.mdx`);

    // Try index.mdx if the path is a directory
    if (!fs.existsSync(filePath)) {
        const indexPath = path.join(CONTENT_DIR, slugPath, "index.mdx");
        if (fs.existsSync(indexPath)) {
            filePath = indexPath;
        } else {
            notFound();
        }
    }

    const source = fs.readFileSync(filePath, "utf-8");
    const rawContent = source.replace(/^---[\s\S]*?---\n?/, "");
    const content = inlineSnippets(rawContent, slugPath);
    const titleMatch = source.match(/title:\s*["']?(.+?)["']?\s*$/m) || content.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1] || slugPath.split("/").pop()?.replace(/-/g, " ") || "Docs";

    const nav = getNavItems();

    return (
        <div className="flex" style={{ height: "calc(100vh - 52px)" }}>
            <aside className="w-[220px] shrink-0 border-r border-[var(--border)] bg-[var(--bg)] overflow-y-auto p-4">
                <Link href="/docs" className="block text-xs font-mono uppercase tracking-widest text-[var(--accent)] mb-4">
                    CopilotKit Docs
                </Link>
                {nav.map(({ section, items }) => (
                    <div key={section} className="mb-4">
                        <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-faint)] mb-2">{section}</div>
                        {items.map((item) => (
                            <Link
                                key={item.slug}
                                href={`/docs/${item.slug}`}
                                className={`block py-1 text-xs transition-colors ${
                                    item.slug === slugPath
                                        ? "text-[var(--accent)] font-medium"
                                        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                                }`}
                            >
                                {item.title}
                            </Link>
                        ))}
                    </div>
                ))}
            </aside>
            <main className="flex-1 max-w-3xl px-8 py-8 overflow-y-auto">
                <h1 className="text-2xl font-semibold text-[var(--text)] tracking-tight mb-6">{title}</h1>
                <div className="reference-content">
                    <MDXRemote source={content} components={components} options={{ mdxOptions: { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeHighlight] } }} />
                </div>
            </main>
        </div>
    );
}
