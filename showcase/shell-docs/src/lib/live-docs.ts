import type { DocsScope } from "@/components/docs-mdx/scope";
import type { FrontendId } from "@/proto/data";
import {
  CHANNEL_GUIDES,
  FRAMEWORK_WINS,
  scopedHref,
  LIVE_FRAMEWORKS,
  LIVE_FRONTENDS,
  REFERENCE_FOLDERS,
  REFERENCE_ROOT_VERSION,
  ROOT_FRAMEWORK,
  frontendHref,
  liveFramework,
  liveFrontend,
  scopeFromPath,
} from "./live-scope";
import { liveSource, referenceSource } from "./live-source";

export { LIVE_FRAMEWORKS, scopedHref } from "./live-scope";

/**
 * `scopedHref`, except when the reader's framework has no such page and the
 * unscoped one exists: `/model-selection` from a Mastra page stays
 * `/model-selection`, since `/mastra/model-selection` would be a 404.
 */
export function liveHref(href: string | undefined, scope: DocsScope) {
  const to = scopedHref(href, scope);
  if (!href || !to || to === href) return to;
  const path = (url: string) => url.split(/[?#]/)[0].split("/").filter(Boolean);
  if (resolveLivePage(path(to)) || !resolveLivePage(path(href))) return to;
  return href;
}

/**
 * Where a URL goes when its frontend lacks the page but another frontend has
 * it: the frontend's quickstart, as shell-docs' frontend picker sent a Slack
 * guide to Vue (`/vue/mastra/tools` opens `/vue/mastra`). So switching
 * frontends from an Angular guide opens Vue's quickstart, not a 404.
 */
export function frontendFallback(path: string[]): string | null {
  const { frontend, slug } = scopeFromPath(path);
  if (!slug) return null;
  const elsewhere = [...new Set(Object.values(LIVE_FRONTENDS))].some(
    (other) =>
      other !== frontend &&
      resolveLivePage(
        frontendHref(path, other, slug).split("/").filter(Boolean),
      ),
  );
  return elsewhere ? frontendHref(path, frontend, "") : null;
}

/**
 * Resolves a docs.copilotkit.ai URL to a page in `src/content`, the way
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

  // `using-these-docs` is a frontend's own page when it has one (Vue's),
  // else its docs status.
  const own =
    !tail || tail === "quickstart"
      ? docPage(`frontends/${first}`)
      : tail === "using-these-docs"
        ? (docPage(`frontends/${first}/using-these-docs`) ??
          docPage(
            first === "angular"
              ? "frontends/angular/docs-status"
              : "frontends/docs-status",
          ))
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
  return CHANNEL_GUIDES.some((guide) => guide.slug === tail)
    ? docPage(`channels/${tail}`)
    : undefined;
}

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
