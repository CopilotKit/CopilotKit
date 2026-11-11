import { FRONTEND_OPTIONS, isChannelFrontend } from "./frontend-options";
import type { FrontendId } from "./frontend-options";
import { CHANNEL_GUIDE_ROUTES } from "./channel-guide-routes";
import type { ChannelGuideSection } from "./channel-guide-routes";
import { buildFrameworkNav, loadDoc, SHARED_GROUP } from "./docs-render";
import { getDocsFolder, ROOT_FRAMEWORK } from "./registry";
import type { NavNode } from "./docs-render";

export type FrontendPageId = Exclude<FrontendId, "react">;

export const FRONTEND_PAGE_IDS = FRONTEND_OPTIONS.filter(
  (option) => option.id !== "react",
).map((option) => option.id) as FrontendPageId[];

export const ANGULAR_GUIDE_PAGES = [
  { title: "Chat UI and customization", slug: "guides/chat-ui" },
  {
    title: "Frontend tools and generative UI",
    slug: "guides/frontend-tools-generative-ui",
  },
  {
    title: "A2UI schemas, styling, and recovery",
    slug: "guides/a2ui",
  },
  {
    title: "Voice and multimodal input",
    slug: "guides/voice-multimodal",
  },
  {
    title: "Human-in-the-loop and interrupts",
    slug: "guides/human-in-the-loop",
  },
  { title: "Shared state and agent context", slug: "guides/shared-state" },
  {
    title: "Threads, memory, attachments, and headless UI",
    slug: "guides/threads-memory-attachments-headless",
  },
  {
    title: "Troubleshooting Angular apps",
    slug: "guides/troubleshooting",
  },
] as const;

interface FrontendGuidePage {
  title: string;
  slug: string;
}

/**
 * Frontend-owned task guides, keyed by frontend. A frontend absent from this
 * map has no guides yet and shows only its quickstart, docs status, and
 * reference in the sidebar.
 */
const FRONTEND_GUIDE_PAGES: Partial<
  Record<FrontendPageId, readonly FrontendGuidePage[]>
> = {
  angular: ANGULAR_GUIDE_PAGES,
};

/**
 * React's root IA names frontend-specific capabilities more granularly than
 * the Angular task guides. Keep selector changes useful without copying the
 * React page tree: each React-only topic lands on the Angular-native guide
 * that owns the same job.
 */
export const ANGULAR_DOC_REDIRECTS: Readonly<Record<string, string>> = {
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
  "generative-ui/reasoning": "guides/frontend-tools-generative-ui",
  "generative-ui": "guides/frontend-tools-generative-ui",
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
  "generative-ui/a2ui/index": "guides/a2ui",
  "generative-ui/a2ui/advanced": "guides/a2ui",
  "generative-ui/a2ui/dynamic-schema": "guides/a2ui",
  "generative-ui/a2ui/fixed-schema": "guides/a2ui",
  "generative-ui/a2ui/styling": "guides/a2ui",
  "generative-ui/mcp-apps": "guides/frontend-tools-generative-ui",
  "frontend-tools": "guides/frontend-tools-generative-ui",
  "human-in-the-loop": "guides/human-in-the-loop",
  "human-in-the-loop/index": "guides/human-in-the-loop",
  "human-in-the-loop/interrupt-flow": "guides/human-in-the-loop",
  "human-in-the-loop/tool-based": "guides/human-in-the-loop",
  "human-in-the-loop/useInterrupt": "guides/human-in-the-loop",
  "human-in-the-loop/headless": "guides/human-in-the-loop",
  // Added 2026-08-01 with the governed-action page; the redirect was missed,
  // so the React nav had a destination Angular could not reach.
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
  "langgraph/quickstart": "langgraph-python/quickstart",
  "(other)/telemetry": "telemetry",
};

export function getFrontendContentSlug(id: FrontendPageId): string {
  return `frontends/${id}`;
}

export const FRONTEND_DOCS_STATUS_CONTENT_SLUG = "frontends/docs-status";

export function getFrontendGuidanceContentSlug(id: FrontendPageId): string {
  if (id === "angular") return "frontends/angular/docs-status";
  if (id === "vue") return "frontends/vue/using-these-docs";
  return FRONTEND_DOCS_STATUS_CONTENT_SLUG;
}

export function getFrontendGuidanceTitle(id: FrontendPageId): string {
  if (id === "vue") return "Using these docs";
  return "Docs status";
}

export function getFrontendUsingTheseDocsPath(id: FrontendPageId): string {
  return `/${id}/using-these-docs`;
}

/** Collapse legacy frontend guide slugs to the public canonical path. */
export function getFrontendCanonicalSlug(
  id: FrontendPageId,
  slugPath: string,
): string {
  if (id !== "angular") return slugPath;
  const publicSlugPath = slugPath.startsWith("(other)/")
    ? slugPath.slice("(other)/".length)
    : slugPath;
  if (publicSlugPath === "docs-status") return "using-these-docs";
  return (
    ANGULAR_DOC_REDIRECTS[slugPath] ??
    ANGULAR_DOC_REDIRECTS[publicSlugPath] ??
    publicSlugPath
  );
}

const FRONTEND_REFERENCE_SLUGS = {
  // A React SPA uses the root React reference unchanged.
  "react-spa": "reference",
  vue: "reference/vue",
  "react-native": "reference/react-native",
  angular: "reference/angular",
  slack: "reference/channels",
  teams: "reference/channels",
} satisfies Record<FrontendPageId, string>;

export function getFrontendReferenceSlug(id: FrontendPageId): string {
  return FRONTEND_REFERENCE_SLUGS[id];
}

function getChannelGuidePages(
  section: ChannelGuideSection,
  excludeSlugs: readonly string[] = [],
): NavNode[] {
  return CHANNEL_GUIDE_ROUTES.filter(
    (route) => route.section === section && !excludeSlugs.includes(route.slug),
  ).map((route) => ({
    type: "page",
    title: route.navTitle,
    slug: route.slug,
  }));
}

export function getFrontendQuickstartNavTree(id: FrontendPageId): NavNode[] {
  if (id === "vue") return buildVueDocsNavTree();

  if (isChannelFrontend(id)) {
    return [
      { type: "section", title: "Getting Started", icon: "lucide/Rocket" },
      { type: "page", title: "Overview", slug: "" },
      ...getChannelGuidePages("getting-started", ["overview"]),
      {
        type: "page",
        title: "Connect and run your agent",
        slug: "connect",
      },
      { type: "section", title: "Build", icon: "lucide/Wand2" },
      ...getChannelGuidePages("build"),
      { type: "section", title: "Production", icon: "lucide/ServerCog" },
      ...getChannelGuidePages("production"),
      {
        type: "page",
        title: "API reference",
        slug: "reference/channels",
        href: "/reference/channels",
      },
    ];
  }

  const frontendName =
    FRONTEND_OPTIONS.find((option) => option.id === id)?.name ?? id;

  const guidePages: NavNode[] = (FRONTEND_GUIDE_PAGES[id] ?? []).map(
    (guide): NavNode => ({
      type: "page",
      title: guide.title,
      slug: guide.slug,
    }),
  );
  const authoredGuides: NavNode[] = [
    ...(id === "angular"
      ? ([
          { type: "page", title: "Feature examples", slug: "features" },
        ] satisfies NavNode[])
      : []),
    ...(guidePages.length > 0
      ? ([
          { type: "section", title: "Guides", icon: "lucide/BookOpen" },
        ] satisfies NavNode[])
      : []),
    ...guidePages,
  ];
  const upcomingGuides: NavNode[] =
    id === "angular"
      ? []
      : [
          {
            type: "section",
            title: frontendName,
            icon: "lucide/RefreshCw",
            variant: "frontend-docs-upcoming",
            quickstartHref: `/${id}`,
            referenceHref: `/${getFrontendReferenceSlug(id)}`,
            frontendDocsStatus: "feature-complete",
          },
        ];

  return [
    { type: "section", title: "Getting Started", icon: "lucide/Rocket" },
    { type: "page", title: "Quickstart", slug: "" },
    {
      type: "page",
      title: getFrontendGuidanceTitle(id),
      slug: "using-these-docs",
    },
    ...authoredGuides,
    {
      type: "page",
      title: "Reference docs",
      slug: getFrontendReferenceSlug(id),
      href: `/${getFrontendReferenceSlug(id)}`,
    },
    ...upcomingGuides,
  ];
}

/** First segments that are folders of their own, never a frontend's page. */
const NON_PAGE_ROOTS = new Set(["frontends", "channels", "integrations"]);

/**
 * Whether `frontend` has a page at `slugPath`, by where the page lives (the
 * docs app's rule, shell-docs/src/lib/live-pages.ts): the frontend's own
 * folder (`frontends/vue`; Slack and Teams also share `channels`), the
 * frontend-neutral pages in `docs/(shared)`, and on React the pages at the
 * content root as well.
 */
export function frontendHasPage(id: FrontendId, slugPath: string): boolean {
  const slug = slugPath.split("/").filter(Boolean).join("/");
  if (NON_PAGE_ROOTS.has(slug.split("/")[0])) return false;
  if (id === "react" || id === "react-spa") {
    // A root page or, through its route group, a shared one.
    return slug !== "" && loadDoc(slug) !== null;
  }
  const folders = isChannelFrontend(id)
    ? [`frontends/${id}`, "channels"]
    : [`frontends/${id}`];
  if (folders.some((folder) => loadDoc(slug ? `${folder}/${slug}` : folder))) {
    return true;
  }
  return slug !== "" && loadDoc(`${SHARED_GROUP}/${slug}`) !== null;
}

function filterVueNavNodes(nodes: NavNode[]): NavNode[] {
  const filtered: NavNode[] = [];
  let sectionIndex: number | null = null;
  let sectionHasPages = false;

  for (const node of nodes) {
    if (node.type === "section") {
      if (sectionIndex !== null && !sectionHasPages) {
        filtered.splice(sectionIndex, 1);
      }
      filtered.push(node);
      sectionIndex = filtered.length - 1;
      sectionHasPages = false;
      continue;
    }

    if (node.type === "group") {
      const children = filterVueNavNodes(node.children);
      if (children.length === 0) continue;
      filtered.push({ ...node, children });
      sectionHasPages = true;
      continue;
    }

    if (node.slug === "" || !frontendHasPage("vue", node.slug)) continue;
    filtered.push(node);
    sectionHasPages = true;
  }

  if (sectionIndex !== null && !sectionHasPages) {
    filtered.splice(sectionIndex, 1);
  }

  return filtered;
}

/**
 * Vue's sidebar is the built-in agent's (`buildFrameworkNav`), keeping only
 * the rows whose page Vue has (`frontendHasPage`), after Vue's own
 * quickstart.
 */
export function buildVueDocsNavTree(): NavNode[] {
  return [
    { type: "page", title: "Quickstart", slug: "" },
    ...filterVueNavNodes(buildFrameworkNav(getDocsFolder(ROOT_FRAMEWORK))),
    {
      type: "page",
      title: "Reference docs",
      slug: "reference/vue",
      href: "/reference/vue",
    },
  ];
}
