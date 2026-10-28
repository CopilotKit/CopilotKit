/// <reference types="mdx" />
// Snippets content names instead of importing: `<RunAndConnect />` renders
// snippets/coagents/run-and-connect-agent.mdx, as shell-docs' SNIPPET_MAP /
// STUB_PARTIAL_MAP did. Given children instead, a name just wraps them
// (shell-docs' older passthrough form).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCompiler } from "@fumadocs/mdx-remote";
import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import type { MDXComponents, MDXContent } from "mdx/types";
import type { ReactNode } from "react";
import A2UI from "@/snippets/shared/generative-ui/a2ui.mdx";
import AgUI from "@/snippets/shared/backend/ag-ui.mdx";
import BuildWithAgents from "@/snippets/shared/guides/build-with-agents.mdx";
import CodingAgents from "@/snippets/shared/coding-agents.mdx";
import CommonIssues from "@/snippets/shared/troubleshooting/common-issues.mdx";
import CopilotCloudConfigureCopilotKitProvider from "@/snippets/copilot-cloud-configure-copilotkit-provider.mdx";
import CopilotRuntime from "@/snippets/copilot-runtime.mdx";
import CopilotUI from "@/snippets/copilot-ui.mdx";
import CustomAgent from "@/snippets/shared/backend/custom-agent.mdx";
import DebugMode from "@/snippets/shared/troubleshooting/debug-mode.mdx";
import DefaultToolRendering from "@/snippets/shared/guides/default-tool-rendering.mdx";
import DisplayOnly from "@/snippets/shared/generative-ui/display-only.mdx";
import ErrorDebugging from "@/snippets/shared/troubleshooting/error-debugging.mdx";
import FrontendTools from "@/snippets/shared/app-control/frontend-tools.mdx";
import GenerativeUISpecsOverview from "@/snippets/shared/generative-ui-specs-overview.mdx";
import HeadlessThreads from "@/snippets/shared/threads/headless-threads.mdx";
import HeadlessUI from "@/snippets/shared/basics/headless-ui.mdx";
import Inspector from "@/snippets/shared/intelligence/inspector.mdx";
import InstallPythonSDK from "@/snippets/install-python-sdk.mdx";
import InstallSDKSnippet from "@/snippets/install-sdk.mdx";
import Interactive from "@/snippets/shared/generative-ui/interactive.mdx";
import LandingCodeShowcase from "@/snippets/landing-code-showcase.mdx";
import LangGraphPlatformDeploymentTabs from "@/snippets/langgraph-platform-deployment-tabs.mdx";
import MCPApps from "@/snippets/shared/generative-ui/mcp-apps.mdx";
import MCPSetup from "@/snippets/shared/guides/mcp-server-setup.mdx";
import MigrateTo1100 from "@/snippets/shared/troubleshooting/migrate-to-1.10.X.mdx";
import MigrateTo182 from "@/snippets/shared/troubleshooting/migrate-to-1.8.2.mdx";
import MigrateToV2 from "@/snippets/shared/troubleshooting/migrate-to-v2.mdx";
import Overview from "@/snippets/shared/intelligence/overview.mdx";
import PrebuiltComponents from "@/snippets/shared/basics/prebuilt-components.mdx";
import ProgrammaticControl from "@/snippets/shared/basics/programmatic-control.mdx";
import ReasoningMessages from "@/snippets/shared/guides/custom-look-and-feel/reasoning-messages.mdx";
import RunAndConnect from "@/snippets/coagents/run-and-connect-agent.mdx";
import SelfHosting from "@/snippets/shared/intelligence/self-hosting.mdx";
import SelfHostingCopilotRuntimeConfigureCopilotKitProvider from "@/snippets/self-hosting-copilot-runtime-configure-copilotkit-provider.mdx";
import SelfHostingCopilotRuntimeCreateEndpoint from "@/snippets/self-hosting-copilot-runtime-create-endpoint.mdx";
import Slots from "@/snippets/shared/basics/slots.mdx";
import ThreadsOverview from "@/snippets/shared/threads/overview.mdx";
import ToolRendering from "@/snippets/shared/generative-ui/tool-rendering.mdx";
import UseAgentSnippet from "@/snippets/use-agent.mdx";
import type { DocsMdxContext } from "./context";
import { getDocsPage } from "./page-store";

/** Component name → snippet, with shell-docs' aliases. */
const SNIPPETS: Record<string, MDXContent> = {
  A2UI,
  AGUI: AgUI,
  AgUI,
  BuildWithAgents,
  CodingAgents,
  CommonIssues,
  CopilotCloudConfigureCopilotKit: CopilotCloudConfigureCopilotKitProvider,
  CopilotCloudConfigureCopilotKitProvider,
  CopilotRuntime,
  CopilotUI,
  CustomAgent,
  DebugMode,
  DefaultToolRendering,
  DisplayOnly,
  ErrorDebugging,
  FrontEndToolsImpl: FrontendTools,
  FrontendTools,
  GenerativeUISpecsOverview,
  HeadlessThreads,
  HeadlessUI,
  Inspector,
  InstallPythonSDK,
  InstallSDKSnippet,
  Interactive,
  LandingCodeShowcase,
  LangGraphPlatformDeploymentTabs,
  MCPApps,
  MCPSetup,
  MigrateTo: MigrateToV2,
  MigrateToV: MigrateToV2,
  MigrateTo1100,
  MigrateTo182,
  MigrateToV2,
  Overview,
  PrebuiltComponents,
  ProgrammaticControl,
  ReasoningMessages,
  RunAndConnect,
  RunAndConnectSnippet: RunAndConnect,
  SelfHosting,
  SelfHostingCopilotRuntimeConfigureCopilotKit:
    SelfHostingCopilotRuntimeConfigureCopilotKitProvider,
  SelfHostingCopilotRuntimeConfigureCopilotKitProvider,
  SelfHostingCopilotRuntimeCreateEndpoint,
  Slots,
  Threads: HeadlessThreads,
  ThreadsOverview,
  ToolRenderer: ToolRendering,
  ToolRendering,
  UseAgentSnippet,
};

/**
 * `<Content partial=…>`'s deploy partials (agentcore is the default). They
 * read `framework` as a bare variable (next-mdx-remote scope in shell-docs),
 * so they're compiled here at runtime with it in scope, like shell-docs'
 * PartialLoader, rather than imported.
 */
const PARTIALS = new Set([
  "integrations/agentcore/index.mdx",
  "integrations/langsmith/index.mdx",
]);

// The live pages' MDX options (src/lib/live-source.ts).
const compiler = createCompiler({
  rehypeCodeOptions: {
    ...rehypeCodeDefaultOptions,
    fallbackLanguage: "plaintext",
    addLanguageClass: true,
  },
});

const partials = new Map<string, Promise<MDXContent>>();

function loadPartial(partial: string, framework: string | undefined) {
  const key = `${partial}::${framework ?? ""}`;
  let pending = partials.get(key);
  if (!pending) {
    pending = readFile(
      join(process.cwd(), "content", "live", "snippets", partial),
      "utf8",
    )
      .then((raw) =>
        compiler.compile({
          source: raw.replace(/^---[\s\S]*?---\r?\n?/, ""),
          scope: { framework },
        }),
      )
      .then((result) => result.body as MDXContent);
    pending.catch(() => partials.delete(key));
    partials.set(key, pending);
  }
  return pending;
}

/**
 * `<SharedContent />` stands for the shared snippet of the page's own topic
 * (shell-docs' SUBPATH_TO_COMPONENT), named by the page's path under its
 * framework.
 */
const SHARED_CONTENT_BY_SUBPATH: Record<string, string> = {
  "ag-ui": "AGUI",
  "build-with-agents": "CodingAgents",
  "copilot-runtime": "CopilotRuntime",
  "custom-look-and-feel/headless-ui": "HeadlessUI",
  "custom-look-and-feel/slots": "Slots",
  "frontend-tools": "FrontendTools",
  "generative-ui/a2ui": "A2UI",
  "generative-ui/mcp-apps": "MCPApps",
  "generative-ui/tool-rendering": "ToolRendering",
  "generative-ui/your-components/display-only": "DisplayOnly",
  "generative-ui/your-components/interactive": "Interactive",
  inspector: "Inspector",
  "prebuilt-components": "PrebuiltComponents",
  "programmatic-control": "ProgrammaticControl",
  "intelligence/headless-ui": "HeadlessUI",
  "intelligence/overview": "Overview",
  "troubleshooting/common-issues": "CommonIssues",
  "troubleshooting/error-debugging": "ErrorDebugging",
  "troubleshooting/migrate-to-1.10.X": "MigrateTo1100",
  "troubleshooting/migrate-to-1.8.2": "MigrateTo182",
  "troubleshooting/migrate-to-v2": "MigrateToV2",
};

/** `path`: the page file, absolute or relative to content/live. */
export function sharedContentFor(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const start = path.startsWith("docs/") ? 0 : path.lastIndexOf("/docs/") + 1;
  if (start === 0 && !path.startsWith("docs/")) return undefined;
  const slug = path
    .slice(start + "docs/".length)
    .replace(/\.mdx?$/, "")
    .replace(/\/index$/, "");
  const sub = /^integrations\/[^/]+\/(.+)$/.exec(slug)?.[1] ?? slug;
  return SHARED_CONTENT_BY_SUBPATH[sub];
}

function hasChildren(children: ReactNode) {
  if (children === undefined || children === null) return false;
  if (typeof children === "string") return children.trim() !== "";
  if (Array.isArray(children)) return children.length > 0;
  return true;
}

/** Shell-docs' passthrough-only names (no snippet behind them). */
const PASSTHROUGH = ["CloudCopilotKit", "CloudCopilotKitProvider"];

export function snippetComponents(ctx: DocsMdxContext): MDXComponents {
  const map: Record<string, (props: Record<string, unknown>) => ReactNode> = {};
  for (const [name, Snippet] of Object.entries(SNIPPETS)) {
    map[name] = ({ children, ...props }) =>
      hasChildren(children as ReactNode) ? (
        <div>{children as ReactNode}</div>
      ) : (
        <Snippet {...props} components={ctx.components()} />
      );
  }
  for (const name of PASSTHROUGH) {
    map[name] = ({ children }) => <div>{children as ReactNode}</div>;
  }
  /**
   * `<SharedContent />` is the shared snippet for the page's own topic
   * (`integrations/agno/ag-ui.mdx` renders the AG-UI snippet), as shell-docs
   * resolved it from the page's path.
   */
  map.SharedContent = ({ children, ...props }) => {
    if (hasChildren(children as ReactNode)) return <div>{children as ReactNode}</div>;
    const name = sharedContentFor(getDocsPage().path);
    const Snippet = name ? SNIPPETS[name] : undefined;
    return Snippet ? <Snippet {...props} components={ctx.components()} /> : null;
  };
  /**
   * A shared deploy partial, given the page's framework so its framework
   * bits (`<AgentCoreCommandTabs framework={framework} />`, per-framework
   * links) narrow to it.
   */
  map.Content = async ({ framework, partial }) => {
    const path = (partial as string | undefined) ?? "integrations/agentcore/index.mdx";
    if (!PARTIALS.has(path)) return null;
    const Partial = await loadPartial(path, framework as string | undefined);
    return <Partial components={ctx.components()} />;
  };
  return map as MDXComponents;
}
