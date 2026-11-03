import type { DocsScope } from "@/components/docs-mdx/scope";
import type { FrontendId } from "@/proto/data";

// How live docs URLs are scoped, shared by the server resolver
// (`live-docs.ts`) and the client sidebar (`src/proto/live-tree.tsx`).

type DocsMode = "generated" | "authored";

/**
 * Each framework's URL slug, its folder under `docs/integrations`, and its
 * `docs_mode` from `showcase/integrations/<slug>/manifest.yaml` (shell-docs'
 * `DOCS_FOLDER_OVERRIDES` and registry). `hidden` frameworks have no docs.
 */
export const LIVE_FRAMEWORKS: Record<
  string,
  { folder: string; mode: DocsMode }
> = {
  ag2: { folder: "ag2", mode: "authored" },
  agno: { folder: "agno", mode: "authored" },
  "built-in-agent": { folder: "built-in-agent", mode: "authored" },
  "claude-sdk-python": { folder: "claude-sdk-python", mode: "generated" },
  "claude-sdk-typescript": {
    folder: "claude-sdk-typescript",
    mode: "generated",
  },
  "crewai-crews": { folder: "crewai-flows", mode: "authored" },
  "google-adk": { folder: "adk", mode: "generated" },
  "langgraph-python": { folder: "langgraph", mode: "generated" },
  "langgraph-typescript": { folder: "langgraph", mode: "generated" },
  "langgraph-fastapi": { folder: "langgraph", mode: "generated" },
  llamaindex: { folder: "llamaindex", mode: "authored" },
  mastra: { folder: "mastra", mode: "authored" },
  "ms-agent-python": {
    folder: "microsoft-agent-framework",
    mode: "authored",
  },
  "ms-agent-dotnet": {
    folder: "microsoft-agent-framework",
    mode: "authored",
  },
  "ms-agent-harness-dotnet": {
    folder: "microsoft-agent-framework",
    mode: "generated",
  },
  "pydantic-ai": { folder: "pydantic-ai", mode: "authored" },
  strands: { folder: "aws-strands", mode: "generated" },
  "strands-typescript": { folder: "aws-strands", mode: "generated" },
  // Docs-only frameworks: no showcase cells, only authored pages.
  a2a: { folder: "a2a", mode: "authored" },
  "agent-spec": { folder: "agent-spec", mode: "authored" },
  deepagents: { folder: "deepagents", mode: "authored" },
};

/** A framework URL slug's docs, if it has any. */
export function liveFramework(slug: string | undefined) {
  return slug && Object.hasOwn(LIVE_FRAMEWORKS, slug)
    ? LIVE_FRAMEWORKS[slug]
    : undefined;
}

/** The frontend a URL prefix scopes to, if it is one. */
export function liveFrontend(segment: string | undefined) {
  return segment && Object.hasOwn(LIVE_FRONTENDS, segment)
    ? LIVE_FRONTENDS[segment]
    : undefined;
}

/** Slugs whose per-framework page wins even when docs are generated. */
export const FRAMEWORK_WINS = new Set(["quickstart", "threads-import"]);

/** URL prefixes that scope a page to a frontend (React is the default). */
export const LIVE_FRONTENDS: Record<string, FrontendId> = {
  "react-spa": "react",
  vue: "vue",
  "react-native": "react-native",
  angular: "angular",
  slack: "slack",
  teams: "teams",
};

/**
 * The Slack and Teams guide (`docs/channels/<slug>`) in sidebar order, with
 * each page's sidebar title and section (shell-docs'
 * `channel-guide-routes.ts`). `/slack` itself opens the guide's overview and
 * `/slack/connect` the channel's quickstart.
 */
export const CHANNEL_GUIDES = [
  {
    slug: "intelligence",
    title: "Configure the Channel in Intelligence",
    section: "Getting Started",
  },
  { slug: "tools", title: "Tools and context", section: "Build" },
  {
    slug: "identity-and-memory",
    title: "Identity and Memory",
    section: "Build",
  },
  {
    slug: "rich-messages",
    title: "Rich messages and components",
    section: "Build",
  },
  {
    slug: "posting-jsx-as-images",
    title: "Posting JSX as images",
    section: "Build",
  },
  {
    slug: "render-and-carousel",
    title: "Render and carousel",
    section: "Build",
  },
  {
    slug: "interactive",
    title: "Interactive messages and approvals",
    section: "Build",
  },
  {
    slug: "commands-and-reactions",
    title: "Commands and reactions",
    section: "Build",
  },
  {
    slug: "files-and-multimodality",
    title: "Files and multimodal input",
    section: "Build",
  },
  { slug: "threads-and-state", title: "Threads and state", section: "Build" },
  {
    slug: "persistence-and-scaling",
    title: "Persistence and scaling",
    section: "Production",
  },
  {
    slug: "history-and-transcripts",
    title: "History and transcripts",
    section: "Production",
  },
  {
    slug: "deploy-and-operate",
    title: "Deploy and operate",
    section: "Production",
  },
] as const;

/** shell-docs serves the React reference at both `/reference/v2/*` and `/reference/*`. */
export const REFERENCE_ROOT_VERSION = "v2";
/** The other SDKs' references live in their own folders under `reference/`. */
export const REFERENCE_FOLDERS = new Set([
  "v1",
  "react-native",
  "vue",
  "angular",
  "core",
  "channels",
]);

/** First URL segments that never take a framework or frontend prefix. */
const UNSCOPED_SEGMENTS = new Set([
  "docs",
  "ag-ui",
  "reference",
  "frontends",
  "api",
  "channels",
  "agentic-protocols",
  "cookbook",
  "examples",
]);

/** shell-docs' unscoped pages are the built-in agent's docs. */
export const ROOT_FRAMEWORK = "built-in-agent";

/**
 * Keeps a root-relative link in the page's scope, as shell-docs'
 * `resolveDocsHref` does: on `/mastra/...`, `/quickstart` means
 * `/mastra/quickstart`. Links that name a framework, frontend, or a global
 * section stay as written.
 */
export function scopedHref(href: string | undefined, scope: DocsScope) {
  if (!href?.startsWith("/") || href.startsWith("//")) return href;
  // shell-docs still serves a framework's pages at their content path
  // (`/docs/integrations/<folder>/...`); here they live at the framework URL.
  const contentPath = href.match(/^\/(?:docs\/)?integrations\/([^/?#]+)(.*)$/);
  if (contentPath) {
    const fw = liveFramework(contentPath[1])
      ? contentPath[1]
      : frameworkForFolder(contentPath[1], scope.framework ?? undefined);
    if (fw) {
      const fe =
        scope.frontend !== "react" ? `/${frontendSegment(scope.frontend)}` : "";
      return `${fe}${fw === ROOT_FRAMEWORK ? "" : `/${fw}`}${contentPath[2]}`;
    }
  }
  const first = href.slice(1).split(/[/?#]/, 1)[0];
  // Content also names a framework by its docs folder (`/langgraph/...`,
  // `/crewai-flows/...`), which shell-docs redirects to a framework URL.
  // Send it to the reader's own framework when that uses the folder.
  const folderFramework = !liveFramework(first)
    ? frameworkForFolder(first, scope.framework ?? undefined)
    : undefined;
  if (folderFramework) {
    const fe =
      scope.frontend !== "react" ? `/${frontendSegment(scope.frontend)}` : "";
    return `${fe}/${folderFramework}${href.slice(1 + first.length)}`;
  }
  if (
    !first ||
    UNSCOPED_SEGMENTS.has(first) ||
    liveFramework(first) ||
    liveFrontend(first)
  ) {
    return href;
  }
  const fw =
    scope.framework && scope.framework !== ROOT_FRAMEWORK
      ? `/${scope.framework}`
      : "";
  const fe =
    scope.frontend !== "react" ? `/${frontendSegment(scope.frontend)}` : "";
  return `${fe}${fw}${href}`;
}

/** The framework a docs folder name points at: the reader's own if it uses the folder. */
function frameworkForFolder(folder: string, current: string | undefined) {
  if (!folder) return undefined;
  if (current && LIVE_FRAMEWORKS[current]?.folder === folder) return current;
  return Object.entries(LIVE_FRAMEWORKS).find(
    ([, f]) => f.folder === folder,
  )?.[0];
}

/** The URL prefix for a frontend (`react-spa` is React's old alias). */
function frontendSegment(frontend: FrontendId) {
  return (
    Object.entries(LIVE_FRONTENDS).find(
      ([segment, id]) => id === frontend && segment !== "react-spa",
    )?.[0] ?? frontend
  );
}

/** The frontend and framework a live URL is scoped to. */
export function scopeFromPath(path: string[]): DocsScope & {
  /** The URL's prefix for that scope (`/vue/mastra`). */
  prefix: string;
  /** The page under it (`frontend-tools`). */
  slug: string;
} {
  const frontend = liveFrontend(path[0]);
  const fePrefix = frontend ? `/${path[0]}` : "";
  const framework = frontend ? path[1] : path[0];
  const scoped = (n: number) => path.slice(n).join("/");
  return liveFramework(framework)
    ? {
        frontend: frontend ?? "react",
        framework: framework!,
        prefix: `${fePrefix}/${framework}`,
        slug: scoped(frontend ? 2 : 1),
      }
    : {
        frontend: frontend ?? "react",
        framework: null,
        prefix: fePrefix,
        slug: scoped(frontend ? 1 : 0),
      };
}

/**
 * The URL's page under another frontend, as shell-docs' frontend picker maps
 * it (`frontendPathForCurrentPath`): `/mastra/frontend-tools` on Vue is
 * `/vue/mastra/frontend-tools`. An app's pages don't carry over to Slack or
 * Teams, so those open the channel's overview; `slug` names another page
 * (`""` for the frontend's quickstart).
 */
export function frontendHref(
  path: string[],
  frontend: FrontendId,
  slug?: string,
) {
  const scope = scopeFromPath(path);
  const isChannel = (id: FrontendId) => id === "slack" || id === "teams";
  const page =
    slug ??
    (isChannel(frontend) && !isChannel(scope.frontend) ? "" : scope.slug);
  const fe = frontend !== "react" ? `/${frontendSegment(frontend)}` : "";
  const fw = scope.framework ? `/${scope.framework}` : "";
  // React has no landing of its own: its quickstart is the framework's.
  const tail = page || (frontend === "react" ? "quickstart" : "");
  return `${fe}${fw}${tail ? `/${tail}` : ""}`;
}
