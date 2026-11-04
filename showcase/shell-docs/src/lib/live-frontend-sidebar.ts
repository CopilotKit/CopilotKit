import { CHANNEL_GUIDES } from "./live-scope";
import type { NavNode } from "./live-sidebar";

/**
 * The sidebars of the frontends that aren't React, ported from shell-docs'
 * `getFrontendQuickstartNavTree` (`frontend-page-content.ts`) and
 * `getAngularDocsNavTree` (`angular-doc-navigation.ts`). Each lists only the
 * pages its frontend has: Slack and Teams their channel guide, React Native
 * its quickstart and reference, Vue and Angular the React sidebar cut to the
 * pages they serve. Slugs are relative to the frontend's prefix (`/vue`,
 * `/angular/mastra`); a frontend's root page (`""`) is its quickstart.
 */

const quickstart: NavNode = {
  type: "page",
  title: "Quickstart",
  slug: "",
  icon: "play",
};

/** `/<frontend>/using-these-docs`, the frontend's docs status. */
const docsStatus = (title: string): NavNode => ({
  type: "page",
  title,
  slug: "using-these-docs",
  icon: "book",
});

const reference = (href: string): NavNode => ({
  type: "page",
  title: "Reference",
  slug: href.slice(1),
  href,
});

/** Slack's and Teams' channel guide (shell-docs' `CHANNEL_GUIDE_ROUTES`). */
export function channelSidebar(): NavNode[] {
  const guides = (section: string): NavNode[] =>
    CHANNEL_GUIDES.filter((g) => g.section === section).map((g) => ({
      type: "page",
      title: g.title,
      slug: g.slug,
    }));
  return [
    { type: "section", title: "Getting Started" },
    { type: "page", title: "Overview", slug: "" },
    ...guides("Getting Started"),
    { type: "page", title: "Connect and run your agent", slug: "connect" },
    { type: "section", title: "Build" },
    ...guides("Build"),
    { type: "section", title: "Production" },
    ...guides("Production"),
    { ...reference("/reference/channels"), title: "API reference" },
  ];
}

/** React Native has its quickstart, docs status, and reference so far. */
export function reactNativeSidebar(): NavNode[] {
  return [
    quickstart,
    docsStatus("Docs status"),
    { type: "section", title: "Learn" },
    reference("/reference/react-native"),
  ];
}

/**
 * Vue follows the root surface's sidebar, keeping only the pages it serves
 * (`buildVueDocsNavTree`), whatever backend the URL names.
 */
export function vueSidebar(
  rootSurface: NavNode[],
  serves: (slug: string) => boolean,
): NavNode[] {
  return [
    quickstart,
    docsStatus("Using these docs"),
    ...withReference(servedOnly(rootSurface, serves), "/reference/vue"),
  ];
}

/** Angular's own task guides, in shell-docs' order (`ANGULAR_GUIDE_PAGES`). */
const ANGULAR_GUIDES: [slug: string, title: string][] = [
  ["guides/chat-ui", "Chat UI and customization"],
  ["guides/frontend-tools-generative-ui", "Frontend tools and generative UI"],
  ["guides/a2ui", "A2UI schemas, styling, and recovery"],
  ["guides/voice-multimodal", "Voice and multimodal input"],
  ["guides/human-in-the-loop", "Human-in-the-loop and interrupts"],
  ["guides/shared-state", "Shared state and agent context"],
  [
    "guides/threads-memory-attachments-headless",
    "Threads, memory, attachments, and headless UI",
  ],
  ["guides/troubleshooting", "Troubleshooting Angular apps"],
];

/**
 * React topics an Angular page covers (shell-docs' `ANGULAR_DOC_REDIRECTS`),
 * so Angular's sidebar lists its chat guide where React's lists six chat
 * pages.
 */
const ANGULAR_PAGE_FOR: Record<string, string> = {
  "concepts/which-hook": "features",
  "agentic-protocols/mcp": "guides/frontend-tools-generative-ui",
  "prebuilt-components": "guides/chat-ui",
  "prebuilt-components/chat": "guides/chat-ui",
  "prebuilt-components/sidebar": "guides/chat-ui",
  "prebuilt-components/popup": "guides/chat-ui",
  "prebuilt-components/chat-controls": "guides/chat-ui",
  "custom-look-and-feel/css": "guides/chat-ui",
  "custom-look-and-feel/slots": "guides/chat-ui",
  "custom-look-and-feel/markdown": "guides/chat-ui",
  "custom-look-and-feel/reasoning-messages": "guides/chat-ui",
  "multimodal-attachments": "guides/voice-multimodal",
  voice: "guides/voice-multimodal",
  "generative-ui": "guides/frontend-tools-generative-ui",
  "generative-ui/reasoning": "guides/frontend-tools-generative-ui",
  "generative-ui/display": "guides/frontend-tools-generative-ui",
  "generative-ui/interactive": "guides/frontend-tools-generative-ui",
  "generative-ui/tool-based": "guides/frontend-tools-generative-ui",
  "generative-ui/tool-rendering": "guides/frontend-tools-generative-ui",
  "generative-ui/backend-tools": "guides/frontend-tools-generative-ui",
  "generative-ui/state-rendering": "guides/frontend-tools-generative-ui",
  "generative-ui/open-generative-ui": "guides/frontend-tools-generative-ui",
  "generative-ui/json-render": "guides/a2ui",
  "generative-ui/hashbrown": "guides/a2ui",
  "generative-ui/declarative-json-render": "guides/a2ui",
  "generative-ui/declarative-hashbrown": "guides/a2ui",
  "generative-ui/your-components/display-only":
    "guides/frontend-tools-generative-ui",
  "generative-ui/your-components/interactive":
    "guides/frontend-tools-generative-ui",
  "generative-ui/your-components/interrupt-based": "guides/human-in-the-loop",
  "generative-ui/a2ui": "guides/a2ui",
  "generative-ui/a2ui/advanced": "guides/a2ui",
  "generative-ui/a2ui/dynamic-schema": "guides/a2ui",
  "generative-ui/a2ui/fixed-schema": "guides/a2ui",
  "generative-ui/a2ui/styling": "guides/a2ui",
  "generative-ui/mcp-apps": "guides/frontend-tools-generative-ui",
  "frontend-tools": "guides/frontend-tools-generative-ui",
  "human-in-the-loop": "guides/human-in-the-loop",
  "human-in-the-loop/interrupt-flow": "guides/human-in-the-loop",
  "human-in-the-loop/tool-based": "guides/human-in-the-loop",
  "human-in-the-loop/useInterrupt": "guides/human-in-the-loop",
  "human-in-the-loop/headless": "guides/human-in-the-loop",
  "human-in-the-loop/governed-actions": "guides/human-in-the-loop",
  "shared-state": "guides/shared-state",
  "shared-state/in-app-agent-read": "guides/shared-state",
  "shared-state/in-app-agent-write": "guides/shared-state",
  "shared-state/state-inputs-outputs": "guides/shared-state",
  "shared-state/predictive-state-updates": "guides/shared-state",
  "shared-state/read": "guides/shared-state",
  "shared-state/write": "guides/shared-state",
  readables: "guides/shared-state",
  "shared-state/rendering-in-app": "guides/shared-state",
  "shared-state/streaming": "guides/shared-state",
  "shared-state/agent-readonly": "guides/shared-state",
  "agent-app-context": "guides/shared-state",
  threads: "guides/threads-memory-attachments-headless",
  "AG-UI-Streams": "guides/threads-memory-attachments-headless",
  "prebuilt-components/copilot-threads-drawer":
    "guides/threads-memory-attachments-headless",
  "headless-threads": "guides/threads-memory-attachments-headless",
  "threads-lifecycle": "guides/threads-memory-attachments-headless",
  "threads-import": "guides/threads-memory-attachments-headless",
  "intelligence/headless-ui": "guides/threads-memory-attachments-headless",
  "intelligence/capture-interactions": "intelligence/standalone-collector",
  "custom-look-and-feel/headless-ui":
    "guides/threads-memory-attachments-headless",
  "programmatic-control": "guides/threads-memory-attachments-headless",
  "troubleshooting/error-reference": "guides/troubleshooting",
  "troubleshooting/error-debugging": "guides/troubleshooting",
  "troubleshooting/inspector-dev-console": "guides/troubleshooting",
  "troubleshooting/hook-explorer": "guides/troubleshooting",
  "deploy-agentcore": "deploy/agentcore",
  "troubleshooting/migrate-to-1.8.2": "using-these-docs",
  "troubleshooting/migrate-to-1.10.X": "using-these-docs",
  "troubleshooting/migrate-to-v2": "using-these-docs",
  "migrate/1.8.2": "using-these-docs",
  "migrate/1.10.X": "using-these-docs",
  "migrate/v2": "using-these-docs",
  "whats-new/v1-50": "using-these-docs",
  "multi-agent-flows": "multi-agent/subagents",
  "ag-ui-protocol": "agentic-protocols/ag-ui",
  "a2a-protocol": "agentic-protocols/a2a",
  "a2a/generative-ui/declarative-a2ui": "guides/a2ui",
  "connect-mcp-servers": "guides/frontend-tools-generative-ui",
  "langgraph/auth": "auth",
};

/**
 * Angular's quickstart and docs, then its backend's sidebar cut to the pages
 * Angular serves (its own, the backend's, and the universal ones), with its
 * guides leading Learn. A React topic an Angular guide covers drops out for
 * the guide.
 */
export function angularSidebar(
  backend: NavNode[],
  serves: (slug: string) => boolean,
): NavNode[] {
  const guides: NavNode = {
    type: "group",
    title: "Angular guides",
    slug: "sidebar#angular-guides",
    defaultOpen: true,
    children: [
      { type: "page", title: "Feature examples", slug: "features" },
      ...ANGULAR_GUIDES.map(
        ([slug, title]): NavNode => ({ type: "page", title, slug }),
      ),
    ],
  };
  // Pages Angular's own rows already list, then each page as it's kept.
  const listed = new Set(["", "quickstart", "using-these-docs"]);
  for (const n of guides.children) if (n.type === "page") listed.add(n.slug);
  const pages = withReference(
    angularPages(backend, serves, listed, new Set(pageSlugs(backend))),
    "/reference/angular",
  );
  const learn =
    pages.findIndex((n) => n.type === "section" && n.title === "Learn") + 1;
  return [
    quickstart,
    docsStatus("Using the Angular docs"),
    ...(learn ? pages.slice(0, learn) : pages),
    guides,
    ...(learn ? pages.slice(learn) : []),
  ];
}

/**
 * `filterResolvableAngularNodes`: each page Angular serves, once. A React
 * topic stands in for its Angular page only where the sidebar doesn't
 * already have that page.
 */
function angularPages(
  nodes: NavNode[],
  serves: (slug: string) => boolean,
  listed: Set<string>,
  inSidebar: Set<string>,
): NavNode[] {
  return nodes.flatMap((n): NavNode[] => {
    if (n.type === "section" || (n.type === "page" && n.href)) return [n];
    if (n.type === "group") {
      const children = angularPages(n.children, serves, listed, inSidebar);
      return children.length ? [{ ...n, children }] : [];
    }
    const angular = ANGULAR_PAGE_FOR[n.slug];
    if (angular && inSidebar.has(angular)) return [];
    const slug = angular ?? n.slug;
    // The Intelligence row and the Intelligence section both open its overview.
    if (listed.has(slug) && slug !== "intelligence/overview") return [];
    if (!serves(slug)) return [];
    listed.add(slug);
    return [{ ...n, slug }];
  });
}

/** Every page slug in a sidebar. */
export function pageSlugs(nodes: NavNode[]): string[] {
  return nodes.flatMap((n) =>
    n.type === "page"
      ? [n.slug]
      : n.type === "group"
        ? pageSlugs(n.children)
        : [],
  );
}

/** The pages `serves` keeps, and the folders left with any. */
function servedOnly(
  nodes: NavNode[],
  serves: (slug: string) => boolean,
): NavNode[] {
  return nodes.flatMap((n): NavNode[] => {
    if (n.type === "section" || (n.type === "page" && n.href)) return [n];
    if (n.type === "page") return serves(n.slug) ? [n] : [];
    const children = servedOnly(n.children, serves);
    return children.length ? [{ ...n, children }] : [];
  });
}

/** Learn's Reference row opens the frontend's own reference. */
function withReference(nodes: NavNode[], href: string): NavNode[] {
  return nodes.map((n) =>
    n.type === "page" && n.href === "/reference"
      ? { ...n, slug: href.slice(1), href }
      : n,
  );
}
