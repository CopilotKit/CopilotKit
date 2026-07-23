import { FRONTEND_OPTIONS, isFrontendEarlyAccess } from "./frontend-options";
import type { FrontendId } from "./frontend-options";
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
    title: "Human-in-the-loop and interrupts",
    slug: "guides/human-in-the-loop",
  },
  { title: "Shared state and agent context", slug: "guides/shared-state" },
  {
    title: "Threads, memory, attachments, and headless UI",
    slug: "guides/threads-memory-attachments-headless",
  },
] as const;

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
  "custom-look-and-feel/reasoning-messages": "guides/chat-ui",
  "multimodal-attachments": "guides/chat-ui",
  voice: "guides/chat-ui",
  "generative-ui/reasoning": "guides/frontend-tools-generative-ui",
  "generative-ui/tool-based": "guides/frontend-tools-generative-ui",
  "generative-ui/tool-rendering": "guides/frontend-tools-generative-ui",
  "generative-ui/state-rendering": "guides/frontend-tools-generative-ui",
  "generative-ui/your-components/display-only":
    "guides/frontend-tools-generative-ui",
  "generative-ui/your-components/interactive":
    "guides/frontend-tools-generative-ui",
  "generative-ui/your-components/interrupt-based": "guides/human-in-the-loop",
  "generative-ui/a2ui": "guides/frontend-tools-generative-ui",
  "generative-ui/a2ui/index": "guides/frontend-tools-generative-ui",
  "generative-ui/a2ui/advanced": "guides/frontend-tools-generative-ui",
  "generative-ui/a2ui/dynamic-schema": "guides/frontend-tools-generative-ui",
  "generative-ui/a2ui/fixed-schema": "guides/frontend-tools-generative-ui",
  "generative-ui/mcp-apps": "guides/frontend-tools-generative-ui",
  "frontend-tools": "guides/frontend-tools-generative-ui",
  "human-in-the-loop": "guides/human-in-the-loop",
  "human-in-the-loop/index": "guides/human-in-the-loop",
  "human-in-the-loop/interrupt-flow": "guides/human-in-the-loop",
  "human-in-the-loop/tool-based": "guides/human-in-the-loop",
  "human-in-the-loop/useInterrupt": "guides/human-in-the-loop",
  "human-in-the-loop/headless": "guides/human-in-the-loop",
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
  "prebuilt-components/copilot-threads-drawer":
    "guides/threads-memory-attachments-headless",
  "headless-threads": "guides/threads-memory-attachments-headless",
  "threads-lifecycle": "guides/threads-memory-attachments-headless",
  "threads-import": "guides/threads-memory-attachments-headless",
  "premium/headless-ui": "guides/threads-memory-attachments-headless",
  "custom-look-and-feel/headless-ui":
    "guides/threads-memory-attachments-headless",
  "programmatic-control": "guides/threads-memory-attachments-headless",
  "troubleshooting/migrate-to-1.8.2": "using-these-docs",
  "troubleshooting/migrate-to-1.10.X": "using-these-docs",
  "troubleshooting/migrate-to-v2": "using-these-docs",
  "troubleshooting/error-debugging": "using-these-docs",
  inspector: "using-these-docs",
  "multi-agent-flows": "multi-agent/subagents",
};

export function getFrontendContentSlug(id: FrontendPageId): string {
  return `frontends/${id}`;
}

export const FRONTEND_GUIDANCE_CONTENT_SLUG = "frontends/using-these-docs";
export const FRONTEND_DOCS_STATUS_CONTENT_SLUG = "frontends/docs-status";

export function getFrontendGuidanceContentSlug(id: FrontendPageId): string {
  if (id === "angular") return "frontends/angular/docs-status";
  return isFrontendEarlyAccess(id)
    ? FRONTEND_GUIDANCE_CONTENT_SLUG
    : FRONTEND_DOCS_STATUS_CONTENT_SLUG;
}

export function getFrontendGuidanceTitle(id: FrontendPageId): string {
  return isFrontendEarlyAccess(id) ? "About early access" : "Docs status";
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
  if (slugPath === "docs-status") return "using-these-docs";
  return ANGULAR_DOC_REDIRECTS[slugPath] ?? slugPath;
}

const FRONTEND_REFERENCE_SLUGS = {
  vue: "reference",
  "react-native": "reference/react-native",
  angular: "reference/angular",
  slack: "reference/channels",
  teams: "reference",
} satisfies Record<FrontendPageId, string>;

export function getFrontendReferenceSlug(id: FrontendPageId): string {
  return FRONTEND_REFERENCE_SLUGS[id];
}

export function getFrontendQuickstartNavTree(id: FrontendPageId): NavNode[] {
  const frontendName =
    FRONTEND_OPTIONS.find((option) => option.id === id)?.name ?? id;

  const authoredGuides: NavNode[] =
    id === "angular"
      ? [
          { type: "page", title: "Feature examples", slug: "features" },
          { type: "section", title: "Guides", icon: "lucide/BookOpen" },
          ...ANGULAR_GUIDE_PAGES.map(
            (guide): NavNode => ({
              type: "page",
              title: guide.title,
              slug: guide.slug,
            }),
          ),
        ]
      : [];
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
            frontendDocsStatus: isFrontendEarlyAccess(id)
              ? "early-access"
              : "feature-complete",
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
