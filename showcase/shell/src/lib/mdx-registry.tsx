// Shared MDX component registry used by all docs-style pages
// (`/docs/...`, `/<framework>/...`). Pulled out of the docs route so
// the framework-scoped catch-all can reuse the same renderer without
// duplicating 1000+ lines of component shims.

import React from "react";
import Link from "next/link";
import {
  Cards,
  Card,
  Accordions,
  Accordion,
} from "@/components/mdx-components";
import { Callout as DocsCallout } from "@/components/docs-callout";
import { Steps as DocsSteps, Step as DocsStep } from "@/components/docs-steps";
import { Tabs as DocsTabs, Tab as DocsTab } from "@/components/docs-tabs";
import { FrameworkTabs } from "@/components/framework-tabs";
import { PropertyReference } from "@/components/property-reference";
import { getRegistry } from "@/lib/registry";

const Callout = DocsCallout;

export const docsComponents = {
  Callout,
  Cards,
  Card,
  Accordions,
  Accordion,
  PropertyReference,
  FeatureIntegrations: ({ feature }: { feature?: string }) => {
    if (!feature) return null;
    const reg = getRegistry();
    const supporting = reg.integrations.filter(
      (i) => i.deployed && i.features?.includes(feature),
    );
    if (supporting.length === 0) return null;
    return (
      <div className="my-6">
        <div className="text-xs font-mono uppercase tracking-widest text-[var(--text-faint)] mb-2">
          Supported by
        </div>
        <div className="flex flex-wrap gap-2">
          {supporting.map((i) => (
            <Link
              key={i.slug}
              href={`/integrations/${i.slug}?demo=${feature}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
            >
              {i.name}
            </Link>
          ))}
        </div>
      </div>
    );
  },
  InlineDemo: ({
    integration,
    demo,
  }: {
    integration?: string;
    demo?: string;
  }) => {
    if (!integration || !demo) return null;
    const reg = getRegistry();
    const int = reg.integrations.find((i) => i.slug === integration);
    if (!int || !int.deployed) return null;
    const demoUrl = `${int.backend_url}/demos/${demo}`;
    return (
      <div className="my-6 rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--bg-elevated)] border-b border-[var(--border)]">
          <span className="text-xs font-mono text-[var(--text-muted)]">
            Live Demo: {int.name} — {demo}
          </span>
          <a
            href={`/integrations/${integration}?demo=${demo}`}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            Open full demo →
          </a>
        </div>
        <iframe
          src={demoUrl}
          className="w-full"
          style={{ height: "500px" }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          loading="lazy"
        />
      </div>
    );
  },
  Note: Callout,
  Warning: ({ children }: { children: React.ReactNode }) => (
    <Callout type="warn">{children}</Callout>
  ),
  Tip: ({ children }: { children: React.ReactNode }) => (
    <Callout type="info">{children}</Callout>
  ),
  Steps: DocsSteps,
  Step: DocsStep,
  CardGroup: Cards,
  Tabs: DocsTabs,
  Tab: DocsTab,
  FrameworkTabs,
  Frame: ({ children }: { children: React.ReactNode }) => (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "0.5rem",
        padding: "1rem",
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  ),
  IntegrationGrid: ({ path }: { path?: string }) => (
    <div
      style={{
        padding: "1rem",
        background: "var(--bg-elevated)",
        borderRadius: "0.5rem",
        marginBottom: "1rem",
        fontSize: "0.875rem",
        color: "var(--text-muted)",
      }}
    >
      See{" "}
      <a href="/integrations" style={{ color: "var(--accent)" }}>
        Integrations
      </a>{" "}
      for all available frameworks{path ? ` (${path})` : ""}.
    </div>
  ),
  FeatureGrid: ({ children }: { children?: React.ReactNode }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "0.75rem",
      }}
    >
      {children}
    </div>
  ),
  Feature: ({
    children,
    title,
  }: {
    children?: React.ReactNode;
    title?: string;
  }) => (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "0.5rem",
        padding: "1rem",
      }}
    >
      {title && (
        <h4 style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{title}</h4>
      )}
      {children}
    </div>
  ),
  video: (props: Record<string, unknown>) => (
    <video
      {...props}
      className={undefined}
      style={{ borderRadius: "0.5rem", width: "100%", marginBottom: "1rem" }}
    />
  ),
  img: (props: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img
      {...props}
      className={undefined}
      style={{ borderRadius: "0.5rem", maxWidth: "100%", marginBottom: "1rem" }}
    />
  ),
  CodeGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Snippet: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Info: Callout,
  Caution: ({ children }: { children: React.ReactNode }) => (
    <Callout type="warn">{children}</Callout>
  ),
  TailoredContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TailoredContentOption: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SharedContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IframeSwitcher: ({
    children,
    src,
  }: {
    children?: React.ReactNode;
    src?: string;
  }) =>
    src ? (
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "0.5rem",
          overflow: "hidden",
          marginBottom: "1rem",
        }}
      >
        <iframe
          src={src}
          style={{ width: "100%", height: "400px", border: "none" }}
        />
      </div>
    ) : (
      <div>{children}</div>
    ),
  IframeSwitcherGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  RunAndConnect: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  RunAndConnectSnippet: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MigrateTo: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MigrateToV: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  HeadlessUI: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ImageZoom: ({ src, alt }: { src?: string; alt?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt || ""}
      style={{
        borderRadius: "0.5rem",
        maxWidth: "100%",
        marginBottom: "1rem",
        cursor: "zoom-in",
      }}
    />
  ),
  InstallSDKSnippet: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MCPApps: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MCPSetup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Overview: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  FrameworkOverview: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommonIssues: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ErrorDebugging: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Observability: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ObservabilityConnectors: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Inspector: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DefaultToolRendering: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DisplayOnly: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Interactive: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PrebuiltComponents: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ProgrammaticControl: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CodingAgents: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Slots: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  FrontendTools: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  FrontEndToolsImpl: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ToolRendering: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ToolRenderer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ReasoningMessages: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  YouTubeVideo: ({ id }: { id?: string }) =>
    id ? (
      <div
        style={{
          position: "relative",
          paddingBottom: "56.25%",
          marginBottom: "1rem",
        }}
      >
        <iframe
          src={`https://www.youtube.com/embed/${id}`}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            border: "none",
            borderRadius: "0.5rem",
          }}
          allowFullScreen
        />
      </div>
    ) : null,
  CTACards: ({ children }: { children?: React.ReactNode }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "0.75rem",
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  ),
  AttributeCards: ({ children }: { children?: React.ReactNode }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "0.75rem",
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  ),
  PatternCard: ({
    children,
    title,
  }: {
    children?: React.ReactNode;
    title?: string;
  }) => (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "0.5rem",
        padding: "1rem",
        marginBottom: "0.75rem",
      }}
    >
      {title && (
        <h4 style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{title}</h4>
      )}
      {children}
    </div>
  ),
  TwoColumnSection: ({ children }: { children: React.ReactNode }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "1.5rem",
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  ),
  EcosystemTable: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  FeatureMatrix: () => (
    <div
      style={{
        padding: "1rem",
        background: "var(--bg-elevated)",
        borderRadius: "0.5rem",
        marginBottom: "1rem",
      }}
    >
      See the{" "}
      <a href="/matrix" style={{ color: "var(--accent)" }}>
        Feature Matrix
      </a>{" "}
      for a full comparison.
    </div>
  ),
  IntegrationsGrid: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IntegrationButtonGroup: ({ children }: { children?: React.ReactNode }) => (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        flexWrap: "wrap",
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  ),
  AGUI: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  AgUI: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  SignUpSection: () => (
    <div
      style={{
        padding: "1rem",
        background: "var(--bg-elevated)",
        borderRadius: "0.5rem",
        marginBottom: "1rem",
      }}
    >
      <a href="https://cloud.copilotkit.ai" style={{ color: "var(--accent)" }}>
        Sign up for CopilotKit Cloud →
      </a>
    </div>
  ),
  LinkToCopilotCloud: () => (
    <a href="https://cloud.copilotkit.ai" style={{ color: "var(--accent)" }}>
      CopilotKit Cloud
    </a>
  ),
  LandingCodeShowcase: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  UseAgentSnippet: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  InstallPythonSDK: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ActionButtons: ({ children }: { children?: React.ReactNode }) => (
    <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
      {children}
    </div>
  ),
  ApproveComponent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AskComponent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotCloudConfigureCopilotKitProvider: ({
    children,
  }: {
    children?: React.ReactNode;
  }) => <div>{children}</div>,
  GenerativeUISpecsOverview: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IOptions: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  JsonOptions: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MessageActionRenderProps: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotRuntime: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Image: ({ src, alt }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src as string}
      alt={(alt as string) || ""}
      style={{ borderRadius: "0.5rem", maxWidth: "100%", marginBottom: "1rem" }}
    />
  ),
  A: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a href={href} style={{ color: "var(--accent)" }}>
      {children}
    </a>
  ),
  Button: ({ children }: { children?: React.ReactNode }) => (
    <button
      style={{
        padding: "0.5rem 1rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  ),
  Link: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a href={href} style={{ color: "var(--accent)" }}>
      {children}
    </a>
  ),
  Code: ({ children }: { children?: React.ReactNode }) => (
    <code>{children}</code>
  ),
  Progress: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  // Lucide icons
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
  AwsStrandsIcon: () => <span>☁️</span>,
  MicrosoftIcon: () => <span>Ⓜ️</span>,
  PydanticAIIcon: () => <span>🐍</span>,
  SiLangchain: () => <span>🔗</span>,
  FaArrowUp: () => <span>↑</span>,
  FaCloud: () => <span>☁️</span>,
  FaGithub: () => <span>⌨️</span>,
  FaServer: () => <span>🖥️</span>,
  FaWrench: () => <span>🔧</span>,
  CopilotKit: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotChat: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotSidebar: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotPopup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotTextarea: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotKitProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotUI: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CloudCopilotKitProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelfHostingCopilotRuntimeCreateEndpoint: ({
    children,
  }: {
    children?: React.ReactNode;
  }) => <div>{children}</div>,
  SelfHostingCopilotRuntimeConfigureCopilotKitProvider: ({
    children,
  }: {
    children?: React.ReactNode;
  }) => <div>{children}</div>,
  AgentState: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AgentStateSnapshot: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AgentRunResponseUpdate: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Bar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  XAxis: () => null,
  YAxis: () => null,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Tooltip: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Markdown: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Chat: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Task: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TasksList: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TasksProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MapCanvas: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Email: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  EmailsProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  EmailThread: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ChatMessage: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MessageFromA: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MessageToA: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Reply: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PlaceCard: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Proposal: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ProposalViewer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TripsProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResearchProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResearchContext: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResearchContextType: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResearchState: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SearchInfo: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SearchProgress: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  YourApp: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  YourMainContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MCPClient: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  McpServerManager: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  McpToolCall: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  GoServer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
};
