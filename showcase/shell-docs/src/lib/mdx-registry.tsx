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
import {
  TailoredContent as RealTailoredContent,
  TailoredContentOption as RealTailoredContentOption,
} from "@/components/react/tailored-content";
import { FrameworkTabs } from "@/components/framework-tabs";
import { OpsPlatformCTA } from "@/components/react/ops-platform-cta";
import { SignupLink } from "@/components/react/signup-link";
import { IframeSwitcher as RealIframeSwitcher } from "@/components/content";
import { PropertyReference } from "@/components/property-reference";
import { IntegrationGrid } from "@/components/integration-grid";
import { DocsLandingNext } from "@/components/docs-landing-next";
import { WhenFrameworkHas } from "@/components/when-framework-has";
import { AgentCoreCommandTabs } from "@/components/agentcore-command-tabs";
import { DemoSource } from "@/components/demo-source";
import { getRegistry } from "@/lib/registry";
import { PartialLoader } from "@/lib/mdx-registry-loader";

const Callout = DocsCallout;

// Stub name → partial path under `src/content/snippets/`. When a live
// MDX page references one of these stubs WITHOUT children (the common
// "<Inspector />" pattern), the registry renders the partial in place
// of an empty `<div>`. With children, the stub falls back to wrapping
// the children — preserving the legacy passthrough shape used by older
// MDX that intentionally inlines content.
//
// This complements `SNIPPET_MAP` in `docs-render.tsx`, which performs
// the same substitution by string regex BEFORE MDX parses the page.
// That regex only matches plain `<Component />` (optionally with a
// `components={...}` attribute), so any stub invoked with other props
// (e.g. `<EcosystemTable data={...} />`) bypasses it and lands here.
// Keeping this map alongside the stub definitions also makes the
// mapping discoverable from a single place.
const STUB_PARTIAL_MAP: Record<string, string> = {
  Inspector: "shared/premium/inspector.mdx",
  GenerativeUISpecsOverview: "shared/generative-ui-specs-overview.mdx",
  ToolRenderer: "shared/generative-ui/tool-rendering.mdx",
  ToolRendering: "shared/generative-ui/tool-rendering.mdx",
  HeadlessUI: "shared/basics/headless-ui.mdx",
  Overview: "shared/premium/overview.mdx",
  Observability: "shared/premium/observability.mdx",
  ObservabilityConnectors:
    "shared/troubleshooting/observability-connectors.mdx",
  CommonIssues: "shared/troubleshooting/common-issues.mdx",
  ErrorDebugging: "shared/troubleshooting/error-debugging.mdx",
  DebugMode: "shared/troubleshooting/debug-mode.mdx",
  MigrateTo: "shared/troubleshooting/migrate-to-v2.mdx",
  MigrateToV: "shared/troubleshooting/migrate-to-v2.mdx",
  CodingAgents: "shared/coding-agents.mdx",
  CustomAgent: "shared/backend/custom-agent.mdx",
  PrebuiltComponents: "shared/basics/prebuilt-components.mdx",
  ProgrammaticControl: "shared/basics/programmatic-control.mdx",
  Slots: "shared/basics/slots.mdx",
  FrontendTools: "shared/app-control/frontend-tools.mdx",
  FrontEndToolsImpl: "shared/app-control/frontend-tools.mdx",
  DefaultToolRendering: "shared/guides/default-tool-rendering.mdx",
  DisplayOnly: "shared/generative-ui/display-only.mdx",
  Interactive: "shared/generative-ui/interactive.mdx",
  MCPApps: "shared/generative-ui/mcp-apps.mdx",
  MCPSetup: "shared/guides/mcp-server-setup.mdx",
  CopilotRuntime: "copilot-runtime.mdx",
  CopilotUI: "copilot-ui.mdx",
  LandingCodeShowcase: "landing-code-showcase.mdx",
  UseAgentSnippet: "use-agent.mdx",
  InstallSDKSnippet: "install-sdk.mdx",
  InstallPythonSDK: "install-python-sdk.mdx",
  RunAndConnect: "coagents/run-and-connect-agent.mdx",
  RunAndConnectSnippet: "coagents/run-and-connect-agent.mdx",
  CopilotCloudConfigureCopilotKitProvider:
    "copilot-cloud-configure-copilotkit-provider.mdx",
  CopilotCloudConfigureCopilotKit:
    "copilot-cloud-configure-copilotkit-provider.mdx",
  SelfHostingCopilotRuntimeCreateEndpoint:
    "self-hosting-copilot-runtime-create-endpoint.mdx",
  SelfHostingCopilotRuntimeConfigureCopilotKitProvider:
    "self-hosting-copilot-runtime-configure-copilotkit-provider.mdx",
  SelfHostingCopilotRuntimeConfigureCopilotKit:
    "self-hosting-copilot-runtime-configure-copilotkit-provider.mdx",
  ReasoningMessages:
    "shared/guides/custom-look-and-feel/reasoning-messages.mdx",
  Threads: "shared/threads/threads.mdx",
};

// Dev-only warning helper for stub components that discard their props.
// Fires once per component name so HMR / re-renders don't spam the console.
const __warnedStubs = new Set<string>();
function warnStub(name: string, propKeys: string[]): void {
  if (process.env.NODE_ENV === "production") return;
  if (propKeys.length === 0) return;
  const key = `${name}:${propKeys.sort().join(",")}`;
  if (__warnedStubs.has(key)) return;
  __warnedStubs.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `[mdx-registry] <${name}> is a non-functional shim — these props were discarded: ${propKeys.join(", ")}. ` +
      `Override <${name}> in the consuming renderer to make it interactive.`,
  );
}

// Wrap a stub so that when invoked WITHOUT children, it renders the
// MDX partial at `STUB_PARTIAL_MAP[name]` via the PartialLoader server
// component. With children, the existing pass-through shape is kept so
// older MDX that inlines content under `<Component>...</Component>`
// continues to render unchanged.
//
// The returned function is an async React server component — MDXRemote
// awaits the returned element so the partial's parsed JSX is composed
// into the rendered tree as if it were inlined at the call site.
//
// `extraProps` are intentionally ignored when delegating to the
// partial: a partial's body is the authoritative content for the
// "no children" rendering. Authors who need prop-driven rendering
// should reach for a dedicated component (see `EcosystemTable` below).
function stubWithPartial(name: string) {
  // Forward-declare the docsComponents map via a getter so the closure
  // sees the fully-initialized export rather than the `undefined` it
  // would otherwise capture at module-init time. This keeps the stub
  // function definitions reorderable inside the registry block.
  const Stub = async ({
    children,
    ...rest
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }): Promise<React.ReactElement | null> => {
    // With non-empty children, preserve the historical passthrough so
    // MDX that intentionally inlines content (the legacy shape this
    // stub replaces) keeps rendering. Drop other props on the floor —
    // this matches the pre-partial behavior.
    //
    // Treat empty strings / empty arrays as "no children" so a
    // self-closing `<Inspector />` whose MDX compiler produces an empty
    // children prop still falls through to the partial loader.
    const hasChildren =
      children !== undefined &&
      children !== null &&
      !(typeof children === "string" && children.trim() === "") &&
      !(Array.isArray(children) && children.length === 0);
    if (hasChildren) {
      return <div>{children}</div>;
    }

    const partialPath = STUB_PARTIAL_MAP[name];
    if (!partialPath) {
      if (process.env.NODE_ENV !== "production") {
        const extras = Object.keys(rest);
        if (extras.length > 0) warnStub(name, extras);
      }
      return null;
    }

    return (
      <PartialLoader
        relativePath={partialPath}
        // The map's component values have heterogeneous prop shapes
        // (Callout, Cards, ImageZoom, etc.). Cast through `unknown` so
        // the loader's loose `Record<string, ComponentType<...>>` type
        // accepts the full union without spelling out every variant.
        components={
          docsComponents as unknown as Record<
            string,
            React.ComponentType<Record<string, unknown>>
          >
        }
      />
    );
  };
  Stub.displayName = `MdxStub(${name})`;
  return Stub;
}

// Dev-only once-per-key log for silent null returns so MDX authors learn
// their embed didn't render.
const __warnedNull = new Set<string>();
function warnSilentNull(component: string, reason: string): void {
  if (process.env.NODE_ENV === "production") return;
  const key = `${component}:${reason}`;
  if (__warnedNull.has(key)) return;
  __warnedNull.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[mdx-registry] <${component}> rendered nothing — ${reason}`);
}

export const docsComponents = {
  Callout,
  Cards,
  Card,
  Accordions,
  Accordion,
  PropertyReference,
  OpsPlatformCTA,
  SignupLink,
  FeatureIntegrations: ({ feature }: { feature?: string }) => {
    if (!feature) {
      warnSilentNull("FeatureIntegrations", "no `feature` prop provided");
      return null;
    }
    const reg = getRegistry();
    const supporting = reg.integrations.filter(
      (i) => i.deployed && i.features?.includes(feature),
    );
    if (supporting.length === 0) {
      warnSilentNull(
        "FeatureIntegrations",
        `no deployed integrations support feature="${feature}"`,
      );
      if (process.env.NODE_ENV !== "production") {
        return (
          <div className="my-6 rounded-md border border-dashed border-[var(--border)] px-3 py-2 text-xs font-mono text-[var(--text-faint)]">
            [mdx-registry] No deployed integrations support feature &quot;
            {feature}&quot;.
          </div>
        );
      }
      return null;
    }
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
    if (!integration || !demo) {
      warnSilentNull(
        "InlineDemo",
        `missing required props (integration=${integration ?? "undefined"}, demo=${demo ?? "undefined"})`,
      );
      return null;
    }
    const reg = getRegistry();
    const int = reg.integrations.find((i) => i.slug === integration);
    if (!int || !int.deployed) {
      warnSilentNull(
        "InlineDemo",
        !int
          ? `no integration with slug="${integration}" in registry`
          : `integration "${integration}" is not deployed`,
      );
      return null;
    }
    // Iframe the integration demo directly (its own backend host).
    const demoUrl = `${int.backend_url}/demos/${demo}`;
    const iframeStyle: React.CSSProperties = {
      width: "100%",
      height: "500px",
      border: "none",
      background: "var(--bg-surface)",
    };
    return (
      <DocsTabs items={["Demo", "Code"]}>
        <DocsTab value="Demo">
          <iframe
            src={demoUrl}
            style={iframeStyle}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            loading="lazy"
          />
        </DocsTab>
        <DocsTab value="Code">
          <DemoSource integration={integration} demo={demo} />
        </DocsTab>
      </DocsTabs>
    );
  },
  Note: Callout,
  Warning: ({ children }: { children: React.ReactNode }) => (
    <Callout type="warn">{children}</Callout>
  ),
  Tip: ({ children }: { children: React.ReactNode }) => (
    <Callout type="info">{children}</Callout>
  ),
  ThreadsEarlyAccess: ({ children }: { children: React.ReactNode }) => (
    <>
      <Callout type="info">
        <strong>Early access:</strong> Threads and the Enterprise Intelligence
        Platform are in early access. APIs may change before general
        availability.
      </Callout>
      {children}
    </>
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
  IntegrationGrid,
  DocsLandingNext,
  // The base registration here works whenever the consumer passes
  // `framework` explicitly. The framework-scoped renderer (DocsPageView)
  // overrides this to inject `defaultFramework` from the URL — same
  // pattern as <Snippet>.
  WhenFrameworkHas,
  AgentCoreCommandTabs,
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
    // Accept user className from MDX — prior impl spread className in then
    // immediately overrode it to `undefined`, silently dropping it.
    <video
      {...props}
      style={{ borderRadius: "0.5rem", width: "100%", marginBottom: "1rem" }}
    />
  ),
  img: (props: Record<string, unknown>) => (
    // Accept user className from MDX (see note on `video` above).
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img
      {...props}
      style={{ borderRadius: "0.5rem", maxWidth: "100%", marginBottom: "1rem" }}
    />
  ),
  CodeGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Snippet: ({ children }: { children?: React.ReactNode }) => {
    // DocsPageView overrides this at consumer sites. If the base registry
    // is used directly without override, surface a visible dev-mode hint
    // so authors notice their Snippet isn't rendering real content.
    if (process.env.NODE_ENV !== "production") {
      warnSilentNull("Snippet", "runtime override required (base stub)");
      return (
        <div className="my-4 rounded-md border border-dashed border-[var(--border)] px-3 py-2 text-xs font-mono text-[var(--text-faint)]">
          [Snippet] runtime override required
          {children ? <div className="mt-1">{children}</div> : null}
        </div>
      );
    }
    return <div>{children}</div>;
  },
  Info: Callout,
  Caution: ({ children }: { children: React.ReactNode }) => (
    <Callout type="warn">{children}</Callout>
  ),
  TailoredContent: RealTailoredContent,
  TailoredContentOption: RealTailoredContentOption,
  SharedContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  // <Content framework="..." /> is used by orphaned `deploy-agentcore`
  // pages (langgraph/* + aws-strands) as a placeholder for content
  // that was never authored. Without a registered shim, MDX rendering
  // throws and ships a 500 in the public sitemap.
  Content: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IframeSwitcher: RealIframeSwitcher,
  IframeSwitcherGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  RunAndConnect: stubWithPartial("RunAndConnect"),
  RunAndConnectSnippet: stubWithPartial("RunAndConnectSnippet"),
  MigrateTo: stubWithPartial("MigrateTo"),
  MigrateToV: stubWithPartial("MigrateToV"),
  HeadlessUI: stubWithPartial("HeadlessUI"),
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
  InstallSDKSnippet: stubWithPartial("InstallSDKSnippet"),
  MCPApps: stubWithPartial("MCPApps"),
  MCPSetup: stubWithPartial("MCPSetup"),
  Overview: stubWithPartial("Overview"),
  FrameworkOverview: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommonIssues: stubWithPartial("CommonIssues"),
  ErrorDebugging: stubWithPartial("ErrorDebugging"),
  Observability: stubWithPartial("Observability"),
  ObservabilityConnectors: stubWithPartial("ObservabilityConnectors"),
  Inspector: stubWithPartial("Inspector"),
  DefaultToolRendering: stubWithPartial("DefaultToolRendering"),
  DisplayOnly: stubWithPartial("DisplayOnly"),
  Interactive: stubWithPartial("Interactive"),
  PrebuiltComponents: stubWithPartial("PrebuiltComponents"),
  ProgrammaticControl: stubWithPartial("ProgrammaticControl"),
  CodingAgents: stubWithPartial("CodingAgents"),
  CustomAgent: stubWithPartial("CustomAgent"),
  DebugMode: stubWithPartial("DebugMode"),
  NewLookAndFeelPreview: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Slots: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  FrontendTools: stubWithPartial("FrontendTools"),
  FrontEndToolsImpl: stubWithPartial("FrontEndToolsImpl"),
  ToolRendering: stubWithPartial("ToolRendering"),
  ToolRenderer: stubWithPartial("ToolRenderer"),
  ReasoningMessages: stubWithPartial("ReasoningMessages"),
  YouTubeVideo: ({ id, title }: { id?: string; title?: string }) =>
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
          title={title || "YouTube video"}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            border: "none",
            borderRadius: "0.5rem",
          }}
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          loading="lazy"
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
  // `<EcosystemTable data={[...]} />` is used by
  // `concepts/generative-ui-overview.mdx` to render a 4-column matrix
  // of generative-UI approaches. There is no partial for this — the
  // data is supplied inline by the page — so the stub returns a real
  // table rendered from `props.data` instead of a `<div>`.
  EcosystemTable: ({
    data,
    children,
  }: {
    data?: Array<{
      approach: string;
      examples?: string;
      strengths?: string;
      weaknesses?: string;
    }>;
    children?: React.ReactNode;
  }) => {
    if (!data || data.length === 0) {
      // Legacy MDX shape — fall back to the previous wrapper-of-children
      // behavior so anything that still authors `<EcosystemTable>...</EcosystemTable>`
      // doesn't disappear from the page.
      return <div>{children}</div>;
    }
    return (
      <div className="overflow-x-auto my-6 rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="bg-[var(--bg-elevated)] text-left px-4 py-3 font-semibold text-[var(--text)] border-b border-[var(--border)]">
                Approach
              </th>
              <th className="bg-[var(--bg-elevated)] text-left px-4 py-3 font-semibold text-[var(--text)] border-b border-[var(--border)]">
                Examples
              </th>
              <th className="bg-[var(--bg-elevated)] text-left px-4 py-3 font-semibold text-[var(--text)] border-b border-[var(--border)]">
                Strengths
              </th>
              <th className="bg-[var(--bg-elevated)] text-left px-4 py-3 font-semibold text-[var(--text)] border-b border-[var(--border)]">
                Weaknesses
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr
                key={`${row.approach}-${idx}`}
                className={
                  idx % 2 === 0
                    ? "bg-[var(--bg-surface)]"
                    : "bg-[var(--bg-elevated)]"
                }
              >
                <td className="px-4 py-2.5 font-medium text-[var(--text)] border-b border-[var(--border-dim)]">
                  {row.approach}
                </td>
                <td className="px-4 py-2.5 text-[var(--text-secondary)] border-b border-[var(--border-dim)]">
                  {row.examples ?? ""}
                </td>
                <td className="px-4 py-2.5 text-[var(--text-secondary)] border-b border-[var(--border-dim)]">
                  {row.strengths ?? ""}
                </td>
                <td className="px-4 py-2.5 text-[var(--text-secondary)] border-b border-[var(--border-dim)]">
                  {row.weaknesses ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  },
  FeatureMatrix: () => {
    const reg = getRegistry();
    const integrations = reg.integrations.filter((i) => i.deployed);

    const columns = [
      { id: "agentic-chat", label: "Chat UI" },
      { id: "gen-ui-tool-based", label: "Tool-Based Gen UI" },
      { id: "tool-rendering", label: "Tool Rendering" },
      { id: "gen-ui-agent", label: "Agentic Gen UI" },
      { id: "hitl-in-chat", label: "Human-in-the-Loop" },
      { id: "frontend-tools", label: "Frontend Tools" },
      { id: "shared-state-read-write", label: "Shared State" },
      { id: "shared-state-streaming", label: "State Streaming" },
      { id: "subagents", label: "Sub-Agents" },
      { id: "declarative-gen-ui", label: "Declarative Gen UI" },
      { id: "agentic-chat-reasoning", label: "Reasoning" },
      { id: "mcp-apps", label: "MCP Apps" },
    ];

    return (
      <div className="overflow-x-auto my-6 rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[var(--bg-elevated)] text-left px-4 py-3 font-semibold text-[var(--text)] border-b border-r border-[var(--border)] min-w-[200px] whitespace-nowrap">
                Framework
              </th>
              {columns.map((col) => (
                <th
                  key={col.id}
                  className="bg-[var(--bg-elevated)] px-3 py-3 text-center font-medium text-[var(--text-muted)] border-b border-[var(--border)] text-xs whitespace-nowrap"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {integrations.map((integration, idx) => {
              const features = new Set(integration.features ?? []);
              const rowBg =
                idx % 2 === 0
                  ? "bg-[var(--bg-surface)]"
                  : "bg-[var(--bg-elevated)]";
              return (
                <tr key={integration.slug} className={rowBg}>
                  <td
                    className={`sticky left-0 z-10 px-4 py-2.5 font-medium text-[var(--text)] border-r border-b border-[var(--border-dim)] whitespace-nowrap ${rowBg}`}
                  >
                    <Link
                      href={`/${integration.slug}`}
                      className="hover:text-[var(--accent)] transition-colors"
                    >
                      {integration.name}
                    </Link>
                  </td>
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className="px-3 py-2.5 text-center border-b border-[var(--border-dim)]"
                    >
                      {features.has(col.id) ? (
                        <span
                          className="text-[var(--accent)]"
                          aria-label="supported"
                        >
                          ✓
                        </span>
                      ) : (
                        <span
                          className="text-[var(--text-faint)] text-xs"
                          aria-label="not supported"
                        >
                          —
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  },
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
  LandingCodeShowcase: stubWithPartial("LandingCodeShowcase"),
  UseAgentSnippet: stubWithPartial("UseAgentSnippet"),
  InstallPythonSDK: stubWithPartial("InstallPythonSDK"),
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
  CopilotCloudConfigureCopilotKitProvider: stubWithPartial(
    "CopilotCloudConfigureCopilotKitProvider",
  ),
  // Alias of CopilotCloudConfigureCopilotKitProvider — historical
  // spelling without the `Provider` suffix appears in tutorials
  // (`ai-powered-textarea/step-2`, `ai-todo-app/step-2`). Keeping both
  // keys so existing MDX renders without throwing.
  CopilotCloudConfigureCopilotKit: stubWithPartial(
    "CopilotCloudConfigureCopilotKit",
  ),
  GenerativeUISpecsOverview: stubWithPartial("GenerativeUISpecsOverview"),
  IOptions: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  JsonOptions: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MessageActionRenderProps: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotRuntime: stubWithPartial("CopilotRuntime"),
  // <Image> honours className/width/height so MDX-side authors can
  // swap light/dark variants via Tailwind's `block dark:hidden` /
  // `hidden dark:block` pattern. The previous shape destructured only
  // `src`/`alt` and silently dropped className, so every page that
  // ships dual diagrams (agentic-protocols, ag-ui, a2a, mcp, etc.)
  // rendered both versions stacked — the user-visible "duplicate
  // image" reports.
  Image: ({
    src,
    alt,
    className,
    width,
    height,
  }: {
    src?: string;
    alt?: string;
    className?: string;
    width?: number | string;
    height?: number | string;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src ?? ""}
      alt={alt ?? ""}
      width={width}
      height={height}
      className={className}
      style={{ borderRadius: "0.5rem", maxWidth: "100%", marginBottom: "1rem" }}
    />
  ),
  A: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a href={href} style={{ color: "var(--accent)" }}>
      {children}
    </a>
  ),
  Button: ({
    children,
    onClick,
    type,
    disabled,
    "aria-label": ariaLabel,
  }: {
    children?: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    "aria-label"?: string;
  }) => {
    if (process.env.NODE_ENV !== "production" && !onClick) {
      // eslint-disable-next-line no-console
      console.warn(
        "[mdx-registry] <Button> rendered without onClick — this is a non-interactive stub. If interactivity is required, wire it up in the consuming MDX renderer.",
      );
    }
    return (
      <button
        // Default to type="button" so a Button inside a <form> (rare in
        // MDX, but possible) does not trigger a submit.
        type={type ?? "button"}
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
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
    );
  },
  Link: ({
    children,
    href,
    ...rest
  }: {
    children?: React.ReactNode;
    href?: string;
    [key: string]: unknown;
  }) =>
    href ? (
      // Route internal MDX <Link> through next/link so navigation is
      // client-side (prior impl rendered a plain <a>, triggering a full
      // page reload on every internal link).
      <Link href={href} {...(rest as Record<string, unknown>)}>
        {children}
      </Link>
    ) : (
      <a {...(rest as Record<string, unknown>)}>{children}</a>
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
  MessageSquareMore: () => <span>💬</span>,
  Network: () => <span>🕸️</span>,
  Newspaper: () => <span>📰</span>,
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
  Blocks: () => <span>🧩</span>,
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
  // Alias of CloudCopilotKitProvider — `crewai-flows/quickstart` and
  // other historical MDX use the unsuffixed spelling. Without this,
  // MDX rendering throws "Expected component CloudCopilotKit to be
  // defined" at runtime → 500 in production.
  CloudCopilotKit: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelfHostingCopilotRuntimeCreateEndpoint: stubWithPartial(
    "SelfHostingCopilotRuntimeCreateEndpoint",
  ),
  SelfHostingCopilotRuntimeConfigureCopilotKitProvider: stubWithPartial(
    "SelfHostingCopilotRuntimeConfigureCopilotKitProvider",
  ),
  // Alias of SelfHostingCopilotRuntimeConfigureCopilotKitProvider —
  // `ai-todo-app/step-2-setup-copilotkit` uses the unsuffixed name.
  SelfHostingCopilotRuntimeConfigureCopilotKit: stubWithPartial(
    "SelfHostingCopilotRuntimeConfigureCopilotKit",
  ),
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
