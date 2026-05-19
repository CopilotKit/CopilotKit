export type MappingKind = "use-existing" | "shim";

export interface ComponentMapping {
  v1Name: string;
  kind: MappingKind;
  target?: string; // for "use-existing": the shell-docs component name
  notes?: string;
}

// One entry per component from audit-output/_summary.json.
// Sorted alphabetically by v1Name for diff-friendliness.
//
// "use-existing" means the component is already registered in
// showcase/shell-docs/src/lib/mdx-registry.tsx (or is a Fumadocs
// builtin / lucide-react icon already pulled in there).
// "shim" means a compatibility shim must be created in
// showcase/shell-docs/src/components/legacy/ by Task 13.
export const COMPONENT_MAPPING: ComponentMapping[] = [
  {
    v1Name: "A2UI",
    kind: "shim",
    notes:
      "MDX snippet passthrough (imports @/snippets/shared/generative-ui/a2ui.mdx). Not yet in mdx-registry; needs shim stub.",
  },
  {
    v1Name: "AGUI",
    kind: "use-existing",
    target: "AGUI",
    notes:
      "Already registered in mdx-registry.tsx as a passthrough <span> wrapper.",
  },
  {
    v1Name: "Accordion",
    kind: "use-existing",
    target: "Accordion",
    notes: "Shell-docs Accordion component exported from mdx-components.tsx.",
  },
  {
    v1Name: "Accordions",
    kind: "use-existing",
    target: "Accordions",
    notes: "Shell-docs Accordions wrapper exported from mdx-components.tsx.",
  },
  {
    v1Name: "ArrowLeftRight",
    kind: "use-existing",
    target: "ArrowLeftRight",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (↔️). Imported from lucide-react in v1 docs.",
  },
  {
    v1Name: "Blocks",
    kind: "use-existing",
    target: "Blocks",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (🧩). Imported from lucide-react in v1 docs.",
  },
  {
    v1Name: "BookA",
    kind: "use-existing",
    target: "BookA",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (📖). Imported from lucide-react in v1 docs.",
  },
  {
    v1Name: "CTACards",
    kind: "use-existing",
    target: "CTACards",
    notes:
      "Already registered in mdx-registry.tsx as a grid layout wrapper. Used by mastra/crewai-flows/pydantic-ai human-in-the-loop pages.",
  },
  {
    v1Name: "Callout",
    kind: "use-existing",
    target: "Callout",
    notes:
      "Shell-docs Callout component from docs-callout.tsx, registered in mdx-registry.tsx.",
  },
  {
    v1Name: "Card",
    kind: "use-existing",
    target: "Card",
    notes: "Shell-docs Card component from mdx-components.tsx.",
  },
  {
    v1Name: "Cards",
    kind: "use-existing",
    target: "Cards",
    notes: "Shell-docs Cards grid from mdx-components.tsx.",
  },
  {
    v1Name: "CodingAgents",
    kind: "use-existing",
    target: "CodingAgents",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → shared/coding-agents.mdx.",
  },
  {
    v1Name: "Cog",
    kind: "use-existing",
    target: "Cog",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (⚙️). Imported from lucide-react in v1 docs.",
  },
  {
    v1Name: "CommonIssues",
    kind: "use-existing",
    target: "CommonIssues",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → shared/troubleshooting/common-issues.mdx.",
  },
  {
    v1Name: "CopilotChat",
    kind: "use-existing",
    target: "CopilotChat",
    notes:
      "Registered in mdx-registry.tsx as passthrough div. Used in code samples inside MDX, not live demos.",
  },
  {
    v1Name: "CopilotCloudConfigureCopilotKitProvider",
    kind: "use-existing",
    target: "CopilotCloudConfigureCopilotKitProvider",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → copilot-cloud-configure-copilotkit-provider.mdx.",
  },
  {
    v1Name: "CopilotKit",
    kind: "use-existing",
    target: "CopilotKit",
    notes:
      "Registered in mdx-registry.tsx as passthrough div. Used in code samples inside MDX.",
  },
  {
    v1Name: "CopilotPopup",
    kind: "use-existing",
    target: "CopilotPopup",
    notes:
      "Registered in mdx-registry.tsx as passthrough div. Used in code samples inside MDX.",
  },
  {
    v1Name: "CopilotRuntime",
    kind: "use-existing",
    target: "CopilotRuntime",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → copilot-runtime.mdx.",
  },
  {
    v1Name: "CopilotSidebar",
    kind: "use-existing",
    target: "CopilotSidebar",
    notes:
      "Registered in mdx-registry.tsx as passthrough div. Used in code samples inside MDX.",
  },
  {
    v1Name: "CopilotTextarea",
    kind: "use-existing",
    target: "CopilotTextarea",
    notes:
      "Registered in mdx-registry.tsx as passthrough div. Used in code samples inside MDX.",
  },
  {
    v1Name: "Cpu",
    kind: "use-existing",
    target: "Cpu",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (💻). Imported from lucide-react in v1 docs.",
  },
  {
    v1Name: "CpuIcon",
    kind: "use-existing",
    target: "CpuIcon",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (💻). Imported from lucide-react in v1 docs.",
  },
  {
    v1Name: "CustomAgent",
    kind: "use-existing",
    target: "CustomAgent",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → shared/backend/custom-agent.mdx.",
  },
  {
    v1Name: "DefaultToolRendering",
    kind: "use-existing",
    target: "DefaultToolRendering",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → shared/guides/default-tool-rendering.mdx.",
  },
  {
    v1Name: "DisplayOnly",
    kind: "use-existing",
    target: "DisplayOnly",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → shared/generative-ui/display-only.mdx.",
  },
  {
    v1Name: "ErrorDebugging",
    kind: "use-existing",
    target: "ErrorDebugging",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → shared/troubleshooting/error-debugging.mdx.",
  },
  {
    v1Name: "FaArrowUp",
    kind: "use-existing",
    target: "FaArrowUp",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (↑). react-icons not in shell-docs deps; emoji shim suffices for docs context.",
  },
  {
    v1Name: "FaCloud",
    kind: "use-existing",
    target: "FaCloud",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (☁️). react-icons not in shell-docs deps.",
  },
  {
    v1Name: "FaGithub",
    kind: "use-existing",
    target: "FaGithub",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (⌨️). react-icons not in shell-docs deps.",
  },
  {
    v1Name: "FaServer",
    kind: "use-existing",
    target: "FaServer",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (🖥️). react-icons not in shell-docs deps.",
  },
  {
    v1Name: "FaWrench",
    kind: "use-existing",
    target: "FaWrench",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (🔧). react-icons not in shell-docs deps.",
  },
  {
    v1Name: "Frame",
    kind: "use-existing",
    target: "Frame",
    notes:
      "Registered in mdx-registry.tsx as a bordered div wrapper (compatible with Mintlify <Frame> shape).",
  },
  {
    v1Name: "FrameworkOverview",
    kind: "use-existing",
    target: "FrameworkOverview",
    notes:
      "Registered in mdx-registry.tsx as passthrough div stub. Used by framework landing pages (llamaindex/index.mdx, langgraph/index.mdx, etc.).",
  },
  {
    v1Name: "FrontendTools",
    kind: "use-existing",
    target: "FrontendTools",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → shared/app-control/frontend-tools.mdx.",
  },
  {
    v1Name: "HeadlessUI",
    kind: "use-existing",
    target: "HeadlessUI",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → shared/basics/headless-ui.mdx.",
  },
  {
    v1Name: "IframeSwitcher",
    kind: "use-existing",
    target: "IframeSwitcher",
    notes:
      "Registered in mdx-registry.tsx, backed by the real IframeSwitcher from components/content/iframe-switcher.tsx.",
  },
  {
    v1Name: "ImageZoom",
    kind: "use-existing",
    target: "ImageZoom",
    notes:
      "Registered in mdx-registry.tsx as a simple <img> with zoom cursor styling.",
  },
  {
    v1Name: "Inspector",
    kind: "use-existing",
    target: "Inspector",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → shared/premium/inspector.mdx.",
  },
  {
    v1Name: "Interactive",
    kind: "use-existing",
    target: "Interactive",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → shared/generative-ui/interactive.mdx.",
  },
  {
    v1Name: "Link",
    kind: "use-existing",
    target: "Link",
    notes:
      "Registered in mdx-registry.tsx, proxied through next/link for client-side navigation.",
  },
  {
    v1Name: "MCPApps",
    kind: "use-existing",
    target: "MCPApps",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → shared/generative-ui/mcp-apps.mdx.",
  },
  {
    v1Name: "MigrateTo1100",
    kind: "shim",
    notes:
      "v1-only migration guide snippet (imports @/snippets/shared/troubleshooting/migrate-to-1.10.X.mdx). Not in mdx-registry; needs shim stub.",
  },
  {
    v1Name: "MigrateTo182",
    kind: "shim",
    notes:
      "v1-only migration guide snippet (imports @/snippets/shared/troubleshooting/migrate-to-1.8.2.mdx). Not in mdx-registry; needs shim stub.",
  },
  {
    v1Name: "MigrateToV2",
    kind: "shim",
    notes:
      "v1-only migration guide snippet (imports @/snippets/shared/troubleshooting/migrate-to-v2.mdx). Not in mdx-registry; needs shim stub. Note: mdx-registry has MigrateToV and MigrateTo but not the full MigrateToV2 name.",
  },
  {
    v1Name: "MonitorIcon",
    kind: "use-existing",
    target: "MonitorIcon",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (🖥️). Imported from lucide-react in v1 docs.",
  },
  {
    v1Name: "Observability",
    kind: "use-existing",
    target: "Observability",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → shared/premium/observability.mdx.",
  },
  {
    v1Name: "OpsPlatformCTA",
    kind: "use-existing",
    target: "OpsPlatformCTA",
    notes:
      "Directly imported from components/react/ops-platform-cta.tsx and registered in mdx-registry.tsx.",
  },
  {
    v1Name: "Overview",
    kind: "use-existing",
    target: "Overview",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → shared/premium/overview.mdx.",
  },
  {
    v1Name: "PaintbrushIcon",
    kind: "use-existing",
    target: "PaintbrushIcon",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (🎨). Imported from lucide-react in v1 docs.",
  },
  {
    v1Name: "Plug",
    kind: "use-existing",
    target: "Plug",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (🔌). Imported from lucide-react in v1 docs.",
  },
  {
    v1Name: "PlugIcon",
    kind: "use-existing",
    target: "PlugIcon",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (🔌). Imported from lucide-react in v1 docs.",
  },
  {
    v1Name: "PrebuiltComponents",
    kind: "use-existing",
    target: "PrebuiltComponents",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → shared/basics/prebuilt-components.mdx.",
  },
  {
    v1Name: "ProgrammaticControl",
    kind: "use-existing",
    target: "ProgrammaticControl",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → shared/basics/programmatic-control.mdx.",
  },
  {
    v1Name: "PydanticAIIcon",
    kind: "use-existing",
    target: "PydanticAIIcon",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (🐍). Imported from @/lib/icons/custom-icons in v1 docs.",
  },
  {
    v1Name: "RepeatIcon",
    kind: "use-existing",
    target: "RepeatIcon",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (🔄). Imported from lucide-react in v1 docs.",
  },
  {
    v1Name: "Reply",
    kind: "use-existing",
    target: "Reply",
    notes:
      "Registered in mdx-registry.tsx as passthrough div. Used in MDX code samples (CopilotTextarea tutorial).",
  },
  {
    v1Name: "RunAndConnect",
    kind: "use-existing",
    target: "RunAndConnect",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → coagents/run-and-connect-agent.mdx.",
  },
  {
    v1Name: "SelfHosting",
    kind: "shim",
    notes:
      "v1 snippet passthrough (imports @/snippets/shared/premium/self-hosting.mdx). Not in mdx-registry; needs shim stub.",
  },
  {
    v1Name: "SelfHostingCopilotRuntimeConfigureCopilotKitProvider",
    kind: "use-existing",
    target: "SelfHostingCopilotRuntimeConfigureCopilotKitProvider",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → self-hosting-copilot-runtime-configure-copilotkit-provider.mdx.",
  },
  {
    v1Name: "SelfHostingCopilotRuntimeCreateEndpoint",
    kind: "use-existing",
    target: "SelfHostingCopilotRuntimeCreateEndpoint",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → self-hosting-copilot-runtime-create-endpoint.mdx.",
  },
  {
    v1Name: "Server",
    kind: "use-existing",
    target: "Server",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (🖥️). Imported from lucide-react in v1 docs.",
  },
  {
    v1Name: "SharedContent",
    kind: "use-existing",
    target: "SharedContent",
    notes:
      "Registered in mdx-registry.tsx as passthrough div. Used by a2a/* and adk/* docs as an alias for shared snippets.",
  },
  {
    v1Name: "SignupLink",
    kind: "use-existing",
    target: "SignupLink",
    notes:
      "Directly imported from components/react/signup-link.tsx and registered in mdx-registry.tsx.",
  },
  {
    v1Name: "Slots",
    kind: "use-existing",
    target: "Slots",
    notes:
      "Registered in mdx-registry.tsx as passthrough div stub (the STUB_PARTIAL_MAP entry maps to shared/basics/slots.mdx).",
  },
  {
    v1Name: "Sparkles",
    kind: "use-existing",
    target: "Sparkles",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (✨). Imported from lucide-react in v1 docs.",
  },
  {
    v1Name: "Step",
    kind: "use-existing",
    target: "Step",
    notes: "Shell-docs Step component from docs-steps.tsx, registered in mdx-registry.tsx.",
  },
  {
    v1Name: "Steps",
    kind: "use-existing",
    target: "Steps",
    notes: "Shell-docs Steps component from docs-steps.tsx, registered in mdx-registry.tsx.",
  },
  {
    v1Name: "Tab",
    kind: "use-existing",
    target: "Tab",
    notes: "Shell-docs Tab component from docs-tabs.tsx, registered in mdx-registry.tsx.",
  },
  {
    v1Name: "Tabs",
    kind: "use-existing",
    target: "Tabs",
    notes: "Shell-docs Tabs component from docs-tabs.tsx, registered in mdx-registry.tsx.",
  },
  {
    v1Name: "TailoredContent",
    kind: "use-existing",
    target: "TailoredContent",
    notes:
      "Directly imported from components/react/tailored-content.tsx and registered in mdx-registry.tsx.",
  },
  {
    v1Name: "TailoredContentOption",
    kind: "use-existing",
    target: "TailoredContentOption",
    notes:
      "Directly imported from components/react/tailored-content.tsx and registered in mdx-registry.tsx.",
  },
  {
    v1Name: "Threads",
    kind: "use-existing",
    target: "Threads",
    notes:
      "Registered in mdx-registry.tsx via STUB_PARTIAL_MAP → shared/threads/threads.mdx.",
  },
  {
    v1Name: "UserIcon",
    kind: "use-existing",
    target: "UserIcon",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (👤). Imported from lucide-react in v1 docs.",
  },
  {
    v1Name: "Wrench",
    kind: "use-existing",
    target: "Wrench",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (🔧). Imported from lucide-react in v1 docs.",
  },
  {
    v1Name: "WrenchIcon",
    kind: "use-existing",
    target: "WrenchIcon",
    notes:
      "Registered in mdx-registry.tsx as emoji shim (🔧). Imported from lucide-react in v1 docs.",
  },
  {
    v1Name: "YouTubeVideo",
    kind: "use-existing",
    target: "YouTubeVideo",
    notes:
      "Registered in mdx-registry.tsx as a YouTube iframe embed (responsive 16:9 wrapper).",
  },
];

export function lookupMapping(v1Name: string): ComponentMapping | undefined {
  return COMPONENT_MAPPING.find((m) => m.v1Name === v1Name);
}
