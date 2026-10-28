import type { TopicSlug } from "./data";

/**
 * Prototype D's sidebar, copied from the sections live on docs.copilotkit.ai
 * today. Pages with a `topic` render the prototype's sample content; the rest
 * render a placeholder with the same title.
 */
/** Icon keys; the sidebar maps them to the same icons the live docs use. */
export type NavIcon =
  | "play"
  | "brain"
  | "kite"
  | "sprout"
  | "layout"
  | "pointer"
  | "sparkles"
  | "server"
  | "book"
  | "wrench";

export type NavItem =
  | {
      kind: "page";
      title: string;
      slug: string;
      icon?: NavIcon;
      /** Where the page lives: under the framework, or in Intelligence. */
      section: "framework" | "intelligence";
      topic?: TopicSlug;
    }
  | { kind: "external"; title: string; url: string }
  | { kind: "link"; title: string; url: string }
  | { kind: "folder"; title: string; items: NavItem[]; defaultOpen?: boolean };

export interface NavSection {
  title?: string;
  icon?: NavIcon;
  items: NavItem[];
}

const page = (
  title: string,
  slug: string,
  topic?: TopicSlug,
  icon?: NavIcon,
): NavItem => ({
  kind: "page",
  title,
  slug,
  section: "framework",
  topic,
  icon,
});
const intel = (title: string, slug: string, icon?: NavIcon): NavItem => ({
  kind: "page",
  title,
  slug,
  section: "intelligence",
  icon,
});
const folder = (
  title: string,
  items: NavItem[],
  defaultOpen?: boolean,
): NavItem => ({ kind: "folder", title, items, defaultOpen });
const external = (title: string, url: string): NavItem => ({
  kind: "external",
  title,
  url,
});

/** Each framework's own pages, from its section on the live docs. */
const FRAMEWORK_PAGES: Record<string, [string, string][]> = {
  "built-in-agent": [
    ["Server tools", "server-tools"],
    ["MCP servers", "mcp-servers"],
    ["Model selection", "model-selection"],
    ["Advanced configuration", "advanced-configuration"],
  ],
  mastra: [["Background tasks", "background-tasks"]],
  "langgraph-python": [
    ["Interrupt flow", "interrupt-flow"],
    ["Configurable", "configurable"],
    ["Subgraphs", "subgraphs"],
    ["Auth", "auth"],
    ["Guardrails", "guardrails"],
  ],
  "langgraph-typescript": [
    ["Interrupt flow", "interrupt-flow"],
    ["Configurable", "configurable"],
    ["Subgraphs", "subgraphs"],
    ["Auth", "auth"],
  ],
  "crewai-crews": [
    ["Advanced", "advanced"],
    ["Multi-agent flows", "multi-agent-flows"],
  ],
  "pydantic-ai": [["Multi-agent flows", "multi-agent-flows"]],
  llamaindex: [["Multi-agent flows", "multi-agent-flows"]],
  ag2: [["Auth", "auth"]],
  "ms-agent-python": [["Auth", "auth"]],
  strands: [["Deploy to AgentCore", "deploy-agentcore"]],
};

export const INTELLIGENCE_NAV: NavItem[] = [
  intel("Overview", ""),
  folder("Get started", [
    intel("Quickstart", "quickstart"),
    intel("Architecture", "architecture"),
    intel("Plans", "plans"),
  ]),
  folder(
    "Features",
    [
      folder("AG-UI Streams", [
        intel("Overview", "threads"),
        intel("Bring your own thread system", "bring-your-own-threads"),
        intel("Add to existing threads", "threads-import"),
        intel("Thread and history lifecycle", "threads-lifecycle"),
        intel("Streams and framework threads", "framework-threads"),
      ]),
      intel("Automatic learning", "learning"),
      intel("User memories", "memory"),
      intel("Capture interactions", "capture-interactions"),
      intel("Standalone collector", "standalone-collector"),
      intel("Captured data", "captured-data"),
      intel("Product analytics", "analytics"),
      intel("Channels", "channels"),
    ],
    true,
  ),
  folder("Hosting", [
    intel("Cloud-hosted", "cloud"),
    intel("Self-hosted", "self-hosting"),
    intel("AWS ECS/Fargate", "ecs"),
    intel("Local evaluation", "local"),
  ]),
];

export function navForFramework(fw: {
  id: string;
  name: string;
}): NavSection[] {
  const own = FRAMEWORK_PAGES[fw.id] ?? [];
  return [
    {
      items: [
        page("Quickstart", "quickstart", "quickstart", "play"),
        page("Build with agents", "build-with-agents", undefined, "brain"),
        intel("Intelligence", "", "kite"),
      ],
    },
    {
      title: "Basics",
      icon: "sprout",
      items: [
        folder("Chat", [
          page("Prebuilt components", "prebuilt-components"),
          folder("Custom look and feel", [
            page("Slots", "slots"),
            page("Headless UI", "headless-ui"),
          ]),
          page("Programmatic control", "programmatic-control"),
        ]),
        folder("Threads", [
          page("Threads drawer", "threads", "threads"),
          page("Headless threads", "headless-threads"),
        ]),
        page("Frontend tools", "frontend-tools"),
      ],
    },
    {
      title: "Generative UI",
      icon: "layout",
      items: [
        folder("Controlled", [
          page("Components as tools", "generative-ui", "generative-ui"),
          page("Tool call rendering", "tool-rendering"),
          page("State rendering", "state-rendering"),
        ]),
        folder("Declarative", [
          page("A2UI", "a2ui"),
          page("JSON Render", "json-render"),
          page("Hashbrown", "hashbrown"),
        ]),
        folder("Open-ended", [
          page("MCP Apps", "mcp-apps"),
          page("Open generative UI", "open-generative-ui"),
        ]),
      ],
    },
    {
      title: "Interactivity",
      icon: "pointer",
      items: [
        folder("Shared state", [
          page("Reading agent state", "shared-state", "shared-state"),
          page("Writing agent state", "writing-agent-state"),
          page("State streaming", "state-streaming"),
        ]),
        folder("Human in the loop", [
          page("Overview", "human-in-the-loop", "human-in-the-loop"),
          page("Pausing the agent for input", "pausing-for-input"),
          page("Headless interrupts", "headless-interrupts"),
          page("Governed action approval UI", "approval-ui"),
        ]),
        page("WebMCP", "webmcp"),
      ],
    },
    {
      title: "Agent capabilities",
      icon: "sparkles",
      items: [
        ...(own.length
          ? [
              folder(
                fw.name,
                own.map(([t, s]) => page(t, s)),
              ),
            ]
          : []),
        page("Sub-agents", "sub-agents"),
      ],
    },
    { title: "Intelligence", icon: "kite", items: INTELLIGENCE_NAV },
    {
      title: "Backend",
      icon: "server",
      items: [
        folder("Runtime", [
          page("Copilot Runtime", "copilot-runtime"),
          page("AG-UI", "ag-ui"),
        ]),
        folder("Debugging", [page("Inspector", "inspector")]),
      ],
    },
    {
      title: "Learn",
      icon: "book",
      items: [
        { kind: "link", title: "Examples", url: "/examples" },
        external("Cookbook", "https://docs.copilotkit.ai/cookbook"),
        external("Reference", "https://docs.copilotkit.ai/reference"),
      ],
    },
    {
      title: "Other",
      icon: "wrench",
      items: [
        folder("Contributing", [
          page("Code contributions", "contributing/code"),
          page("Documentation contributions", "contributing/docs"),
        ]),
        folder("Troubleshooting", [
          page("Migrate to v2", "migrate/v2"),
          page("Error debugging and observability", "troubleshooting/errors"),
          page("Common issues", "troubleshooting/common-issues"),
          page("Migrate to 1.10.x", "migrate/1-10"),
          page("Migrate to 1.8.2", "migrate/1-8-2"),
        ]),
        page("Open-source telemetry", "telemetry"),
        page("Community frameworks", "community-frameworks"),
      ],
    },
  ];
}

/** Finds a page's title by where it lives, for the article header. */
export function findNavTitle(
  sections: NavSection[],
  section: "framework" | "intelligence",
  slug: string,
): string | undefined {
  const walk = (items: NavItem[]): string | undefined => {
    for (const item of items) {
      if (item.kind === "folder") {
        const hit = walk(item.items);
        if (hit) return hit;
      } else if (
        item.kind === "page" &&
        item.section === section &&
        item.slug === slug
      ) {
        return item.title;
      }
    }
  };
  for (const s of sections) {
    const hit = walk(s.items);
    if (hit) return hit;
  }
}
