import type { DocsScope } from "@/components/docs-mdx/scope";
import type { FrontendId } from "@/proto/data";
import {
  FRAMEWORK_WINS,
  LIVE_FRAMEWORKS,
  REFERENCE_FOLDERS,
  REFERENCE_ROOT_VERSION,
  ROOT_FRAMEWORK,
  liveFramework,
  liveFrontend,
} from "./live-scope";
import { liveSource, referenceSource } from "./live-source";

export { LIVE_FRAMEWORKS, scopedHref } from "./live-scope";

/**
 * Resolves a docs.copilotkit.ai URL to a page in `content/live`, the way
 * shell-docs does (`src/lib/docs-render.tsx`, `src/app/[framework]`), so every
 * live URL keeps working:
 *
 *   /frontend-tools                 docs/frontend-tools.mdx
 *   /mastra/frontend-tools          docs/integrations/mastra/frontend-tools.mdx,
 *                                   else docs/frontend-tools.mdx scoped to Mastra
 *   /vue/mastra/frontend-tools      the same, scoped to Vue
 *   /vue                            docs/frontends/vue.mdx
 *   /reference/v2/hooks/use-agent   reference/hooks/use-agent.mdx
 */

export type LivePage =
  | NonNullable<ReturnType<typeof liveSource.getPage>>
  | NonNullable<ReturnType<typeof referenceSource.getPage>>;

export interface ResolvedLivePage {
  page: LivePage;
  scope: DocsScope;
  /** Path under shell-docs' `src/content`, the source of truth for edits. */
  contentPath: string;
}

const docPage = (slug: string) =>
  liveSource.getPage(slug.split("/").filter(Boolean));

export function resolveLivePage(input: string[]): ResolvedLivePage | null {
  // `/agentic-protocols/index` is `/agentic-protocols`.
  const path = input.at(-1) === "index" ? input.slice(0, -1) : input;
  const [first, ...rest] = path;
  if (!first) return null;

  if (first === "reference") {
    const slugs = rest[0] === REFERENCE_ROOT_VERSION ? rest.slice(1) : rest;
    const page = referenceSource.getPage(slugs);
    return page
      ? {
          page,
          scope: { framework: null, frontend: "react" },
          contentPath: `reference/${page.path}`,
        }
      : null;
  }

  const frontend = liveFrontend(first);
  if (!frontend) return resolveScoped(path, "react");

  // `/vue/mastra/...`: the backend after the frontend is optional.
  const framework = liveFramework(rest[0]) ? rest[0] : null;
  const tail = (framework ? rest.slice(1) : rest).join("/");
  const scope = { framework, frontend };

  if (frontend === "slack" || frontend === "teams") {
    const guide = channelGuide(first, tail);
    if (guide) return found(guide, scope);
  }

  const own =
    !tail || tail === "quickstart"
      ? docPage(`frontends/${first}`)
      : tail === "using-these-docs"
        ? docPage(
            first === "angular"
              ? "frontends/angular/docs-status"
              : "frontends/docs-status",
          )
        : docPage(`frontends/${first}/${tail}`);
  if (own) return found(own, scope);
  return resolveScoped(rest, frontend);
}

/**
 * Slack and Teams share one guide (`docs/channels`): `/slack` and
 * `/slack/<framework>` open its overview, `/slack/connect` the channel's
 * quickstart, `/slack/tools` its Tools page (shell-docs'
 * `channel-guide-routes.ts`).
 */
function channelGuide(channel: string, tail: string) {
  if (!tail || tail === "overview") return docPage("channels");
  if (tail === "connect") return docPage(`frontends/${channel}`);
  return CHANNEL_GUIDES.has(tail) ? docPage(`channels/${tail}`) : undefined;
}

const CHANNEL_GUIDES = new Set([
  "intelligence",
  "tools",
  "identity-and-memory",
  "rich-messages",
  "posting-jsx-as-images",
  "render-and-carousel",
  "interactive",
  "commands-and-reactions",
  "files-and-multimodality",
  "threads-and-state",
  "persistence-and-scaling",
  "history-and-transcripts",
  "deploy-and-operate",
]);

function resolveScoped(
  path: string[],
  frontend: FrontendId,
): ResolvedLivePage | null {
  const [first, ...rest] = path;
  if (!first) return null;
  const fw = liveFramework(first);
  if (fw) {
    const slug = rest.join("/");
    // A framework's root opens its quickstart (the route redirects).
    if (!slug) return null;
    const own = `integrations/${fw.folder}/${slug}`;
    const order =
      fw.mode === "authored" || FRAMEWORK_WINS.has(slug)
        ? [own, slug]
        : [slug, own];
    for (const candidate of order) {
      const page = docPage(candidate);
      if (page) return found(page, { framework: first, frontend });
    }
    return null;
  }
  // Framework folders are only reachable through their framework's URL.
  if (first === "integrations") return null;
  // shell-docs' unscoped pages are the built-in agent's docs: its own page
  // wins (`/quickstart`, `/angular/model-selection`). On React, a root page
  // is scoped to it only when it pins a showcase cell (`UnscopedDocsPage`),
  // so a page's `snippet_framework` still applies otherwise.
  const { folder } = LIVE_FRAMEWORKS[ROOT_FRAMEWORK];
  const own = docPage(`integrations/${folder}/${path.join("/")}`);
  if (own) {
    return found(own, {
      framework: frontend === "react" ? ROOT_FRAMEWORK : null,
      frontend,
    });
  }
  const page = liveSource.getPage(path);
  if (!page) return null;
  const pinsCell =
    frontend === "react" && typeof page.data.snippet_cell === "string";
  return found(page, {
    framework: pinsCell ? ROOT_FRAMEWORK : null,
    frontend,
  });
}

function found(
  page: NonNullable<ReturnType<typeof liveSource.getPage>>,
  scope: DocsScope,
): ResolvedLivePage {
  return { page, scope, contentPath: `docs/${page.path}` };
}

/** Every live URL the site serves, for static generation and sitemaps. */
export function liveParams(): { path: string[] }[] {
  const out = new Map<string, string[]>();
  const add = (p: string[]) => out.set(p.join("/"), p);
  for (const page of liveSource.getPages()) {
    const [head, folder, ...tail] = page.slugs;
    if (head !== "integrations") {
      if (page.slugs.length) add(page.slugs);
      continue;
    }
    for (const [slug, fw] of Object.entries(LIVE_FRAMEWORKS)) {
      if (fw.folder !== folder || !tail.length) continue;
      // The built-in agent's pages are the root ones (`/quickstart`).
      add(slug === ROOT_FRAMEWORK ? tail : [slug, ...tail]);
    }
  }
  for (const page of referenceSource.getPages()) {
    add(
      REFERENCE_FOLDERS.has(page.slugs[0])
        ? ["reference", ...page.slugs]
        : ["reference", REFERENCE_ROOT_VERSION, ...page.slugs],
    );
  }
  return [...out.values()].map((path) => ({ path }));
}
