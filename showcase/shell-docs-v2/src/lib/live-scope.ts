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
  const first = href.slice(1).split(/[/?#]/, 1)[0];
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
} {
  const frontend = liveFrontend(path[0]);
  const fePrefix = frontend ? `/${path[0]}` : "";
  const framework = frontend ? path[1] : path[0];
  return liveFramework(framework)
    ? {
        frontend: frontend ?? "react",
        framework: framework!,
        prefix: `${fePrefix}/${framework}`,
      }
    : { frontend: frontend ?? "react", framework: null, prefix: fePrefix };
}
