import type { DocsScope } from "@/components/docs-mdx/scope";
import type { FrontendId } from "@/proto/data";
import { frameworkSupports } from "@/components/docs-mdx/showcase/framework-gates";
import {
  LIVE_FRAMEWORKS,
  REFERENCE_FOLDERS,
  REFERENCE_ROOT_VERSION,
  ROOT_FRAMEWORK,
  frontendSegment,
  isChannel,
  scopeFromPath,
  scopedHref,
} from "./live-scope";
import { whereIs } from "./live-pages";
import type { PageIndex, PageLocation } from "./live-pages";
import { liveSource, referenceSource } from "./live-source";
import { frameworkOverviews } from "@/data/frameworks";
import type { FrameworkOverviewData } from "@/data/frameworks";

export { LIVE_FRAMEWORKS, scopedHref } from "./live-scope";

/**
 * Resolves a docs.copilotkit.ai URL to a page in `src/content`. The URL names
 * the reader's frontend and framework (`/vue/mastra/frontend-tools`); the
 * page comes from `whereIs` (`src/lib/live-pages.ts`):
 *
 *   /frontend-tools                 docs/frontend-tools.mdx
 *   /mastra/frontend-tools          the same page, with Mastra's code
 *   /mastra/background-tasks        docs/integrations/mastra/background-tasks.mdx
 *   /vue/mastra/frontend-tools      docs/frontends/vue/frontend-tools.mdx
 *   /slack/tools                    docs/channels/tools.mdx
 *   /backend/copilot-runtime        docs/(shared)/backend/copilot-runtime.mdx
 *   /mastra                         docs/integrations/mastra/index.mdx
 *   /google-adk                     src/data/frameworks/google-adk.ts
 *   /vue                            docs/frontends/vue/index.mdx
 *   /reference/v2/hooks/use-agent   reference/hooks/use-agent.mdx
 */

type DocPage = NonNullable<ReturnType<typeof liveSource.getPage>>;

export type LivePage =
  | DocPage
  | NonNullable<ReturnType<typeof referenceSource.getPage>>;

export interface ResolvedLivePage {
  page: LivePage;
  scope: DocsScope;
  /** Path under `src/content`, the source of truth for edits. */
  contentPath: string;
  /**
   * A generated framework's landing (`/google-adk`), drawn from its record in
   * `src/data/frameworks`. `page` is then the framework's quickstart, which
   * the landing's Markdown serves.
   */
  overview?: FrameworkOverviewData;
  /** The page's one indexed URL (`canonicalUrl`). */
  canonical: string;
}

const docPage = (slug: string) =>
  liveSource.getPage(slug.split("/").filter(Boolean));

const isShared = (page: DocPage) => page.path.startsWith("(shared)/");

/** A folder's pages by slug inside it (`""` is its index). */
function folderSlugs(folder: string): string[] {
  const prefix = `${folder}/`;
  return liveSource.getPages().flatMap((page) => {
    const slug = page.slugs.join("/");
    if (slug === folder) return [""];
    return slug.startsWith(prefix) ? [slug.slice(prefix.length)] : [];
  });
}

let index: PageIndex | undefined;

/** Every page's place, for `whereIs`. Built once per server process. */
export function getPageIndex(): PageIndex {
  if (index) return index;
  const folders: Record<string, string[]> = {};
  for (const folder of [
    "frontends/vue",
    "frontends/angular",
    "frontends/react-native",
    "frontends/slack",
    "frontends/teams",
    "channels",
  ]) {
    folders[folder] = folderSlugs(folder);
  }
  for (const { folder } of Object.values(LIVE_FRAMEWORKS)) {
    folders[`integrations/${folder}`] ??= folderSlugs(`integrations/${folder}`);
  }
  const react: string[] = [];
  const shared: string[] = [];
  const features = new Map<string, string>();
  for (const page of liveSource.getPages()) {
    const slug = page.slugs.join("/");
    if (!slug || /^(frontends|channels|integrations)(\/|$)/.test(slug)) {
      continue;
    }
    (isShared(page) ? shared : react).push(slug);
    const cell = page.data.snippet_cell;
    if (typeof cell === "string") features.set(slug, cell);
  }
  const unsupported: Record<string, string[]> = {};
  for (const fw of Object.keys(LIVE_FRAMEWORKS)) {
    unsupported[fw] = [...features]
      .filter(([, cell]) => !frameworkSupports(fw, cell))
      .map(([slug]) => slug);
  }
  index = { folders, react, shared, unsupported };
  return index;
}

export function resolveLivePage(input: string[]): ResolvedLivePage | null {
  // `/agentic-protocols/index` is `/agentic-protocols`.
  const path = input.at(-1) === "index" ? input.slice(0, -1) : input;
  if (!path.length) return null;

  if (path[0] === "reference") {
    const rest = path.slice(1);
    const slugs = rest[0] === REFERENCE_ROOT_VERSION ? rest.slice(1) : rest;
    const page = referenceSource.getPage(slugs);
    return page
      ? {
          page,
          scope: { framework: null, frontend: "react" },
          contentPath: `reference/${page.path}`,
          canonical: referenceUrl(page.slugs),
        }
      : null;
  }

  const { frontend, framework, slug } = scopeFromPath(path);
  const scope: DocsScope = { framework, frontend };
  if (!slug && framework && frontend === "react") {
    return frameworkLanding(framework);
  }
  if (!slug && frontend === "react") return null;
  const at = whereIs(getPageIndex(), frontend, framework, slug);
  if (!at) return null;
  const page = pageAt(at);
  if (!page) return null;
  // A root page at an unscoped URL reads as the built-in agent's when it
  // pins a showcase cell; otherwise its `snippet_framework` applies.
  const unscopedReact =
    !framework &&
    frontend === "react" &&
    (at.kind === "react" || at.kind === "shared");
  return {
    page,
    scope: unscopedReact
      ? {
          framework:
            typeof page.data.snippet_cell === "string" ? ROOT_FRAMEWORK : null,
          frontend,
        }
      : at.kind === "framework" && !framework
        ? { framework: ROOT_FRAMEWORK, frontend }
        : scope,
    contentPath: `docs/${page.path}`,
    canonical: canonicalUrl(at, scope),
  };
}

function pageAt(at: PageLocation): DocPage | undefined {
  return at.kind === "frontend" || at.kind === "framework"
    ? docPage(at.slug ? `${at.folder}/${at.slug}` : at.folder)
    : docPage(at.slug);
}

/**
 * A framework's landing: its overview record (`src/data/frameworks`), else
 * its folder's `index.mdx`.
 */
function frameworkLanding(slug: string): ResolvedLivePage | null {
  const { folder } = LIVE_FRAMEWORKS[slug];
  const scope = { framework: slug, frontend: "react" as const };
  const canonical = `/${slug}`;
  const overview = frameworkOverviews[slug];
  if (overview) {
    const quickstart =
      docPage(`integrations/${folder}/quickstart`) ?? docPage("quickstart");
    return quickstart
      ? {
          page: quickstart,
          scope,
          contentPath: `docs/${quickstart.path}`,
          overview,
          canonical,
        }
      : null;
  }
  const page = docPage(`integrations/${folder}`);
  return page
    ? { page, scope, contentPath: `docs/${page.path}`, canonical }
    : null;
}

/**
 * The one URL a page is indexed under. The reader's framework is dropped
 * unless the page is the framework's own, and the frontend is dropped
 * unless the page is the frontend's own, so `/vue/mastra/backend/copilot-runtime`
 * is `/backend/copilot-runtime` and `/teams/mastra/tools` is `/teams/tools`.
 * A shared page the built-in agent has no showcase cell for lives under the
 * first framework that has one. Framework quickstarts keep their framework,
 * so every framework's quickstart is indexed.
 */
export function canonicalUrl(at: PageLocation, scope: DocsScope): string {
  if (at.kind === "framework") {
    const fw = scope.framework ?? ROOT_FRAMEWORK;
    const first = at.slug === "quickstart" ? fw : firstFrameworkFor(at.folder);
    return url(first === ROOT_FRAMEWORK ? "" : first, at.slug);
  }
  const fe =
    at.kind !== "frontend"
      ? ""
      : isChannel(scope.frontend)
        ? scope.frontend
        : frontendSegment(scope.frontend);
  const fw = supportingFramework(at.slug);
  return url(fe, fw === ROOT_FRAMEWORK ? "" : (fw ?? ""), at.slug);
}

/**
 * The built-in agent when its showcase has the feature a page documents,
 * else the first framework (registry order) whose showcase does.
 */
function supportingFramework(slug: string): string | undefined {
  const { unsupported } = getPageIndex();
  if (!unsupported[ROOT_FRAMEWORK]?.includes(slug)) return ROOT_FRAMEWORK;
  return Object.keys(LIVE_FRAMEWORKS).find(
    (fw) => !unsupported[fw]?.includes(slug),
  );
}

/** A URL from its non-empty segments (`url("", "x")` is `/x`). */
const url = (...parts: string[]) => `/${parts.filter(Boolean).join("/")}`;

/** A URL's path segments, without its query or hash. */
const segmentsOf = (href: string) =>
  href.split(/[?#]/)[0].split("/").filter(Boolean);

/** The first framework (registry order) whose own pages live in `folder`. */
function firstFrameworkFor(folder: string): string {
  const name = folder.replace(/^integrations\//, "");
  return (
    Object.keys(LIVE_FRAMEWORKS).find(
      (slug) => LIVE_FRAMEWORKS[slug].folder === name,
    ) ?? name
  );
}

/** A reference page's live URL: React's under `/reference/v2`, other SDKs under their folder. */
export function referenceUrl(slugs: string[]): string {
  const path = REFERENCE_FOLDERS.has(slugs[0])
    ? slugs
    : [REFERENCE_ROOT_VERSION, ...slugs];
  return `/reference/${path.join("/")}`;
}

/**
 * Where an unscoped URL goes when the built-in agent has no showcase cell for
 * its page: the page's canonical URL, under a framework that has one. The
 * URL was the page's home before the showcase decided which frameworks have
 * it, so links to it keep working.
 */
export function unsupportedRedirect(path: string[]): string | null {
  const { frontend, framework, slug } = scopeFromPath(path);
  if (framework || !slug) return null;
  const pages = getPageIndex();
  if (!pages.unsupported[ROOT_FRAMEWORK]?.includes(slug)) return null;
  const fw = supportingFramework(slug);
  if (!fw || fw === ROOT_FRAMEWORK) return null;
  const at = whereIs(pages, frontend, fw, slug);
  return at ? canonicalUrl(at, { framework: fw, frontend }) : null;
}

/**
 * `scopedHref`, except when the reader's scope has no such page: then the
 * page's canonical URL, so `/model-selection` from a Mastra page stays
 * `/model-selection`, since `/mastra/model-selection` would be a 404.
 */
export function liveHref(href: string | undefined, scope: DocsScope) {
  const to = scopedHref(href, scope);
  if (!href || !to || to === href) return to;
  if (resolveLivePage(segmentsOf(to))) return to;
  const own = resolveLivePage(segmentsOf(href));
  if (!own) return to;
  const rest = href.slice(href.split(/[?#]/)[0].length);
  return `${own.canonical}${rest}`;
}

/**
 * Every page once, at its canonical URL (`canonicalUrl`), plus each
 * framework's landing and quickstart, and the reference. Channel guide pages
 * are listed once per channel, since each channel reads its own version.
 * The sitemap, llms.txt, search, and MCP all list these.
 */
export function livePages(): ResolvedLivePage[] {
  const urls = new Set<string>();
  const pages = getPageIndex();
  const frameworks = Object.keys(LIVE_FRAMEWORKS);
  for (const slug of [...pages.react, ...pages.shared]) {
    const kind = pages.react.includes(slug) ? "react" : "shared";
    urls.add(
      canonicalUrl({ kind, slug }, { framework: null, frontend: "react" }),
    );
  }
  for (const [folder, slugs] of Object.entries(pages.folders)) {
    if (folder.startsWith("integrations/")) continue;
    const frontends =
      folder === "channels"
        ? ["slack", "teams"]
        : [folder.replace(/^frontends\//, "")];
    for (const fe of frontends) {
      for (const slug of slugs) {
        urls.add(
          canonicalUrl(
            { kind: "frontend", folder, slug },
            { framework: null, frontend: fe as FrontendId },
          ),
        );
      }
    }
  }
  for (const fw of frameworks) {
    if (fw !== ROOT_FRAMEWORK) urls.add(`/${fw}`);
    const folder = `integrations/${LIVE_FRAMEWORKS[fw].folder}`;
    for (const slug of pages.folders[folder] ?? []) {
      if (!slug) continue;
      urls.add(
        canonicalUrl(
          { kind: "framework", folder, slug },
          { framework: fw, frontend: "react" },
        ),
      );
    }
  }
  for (const page of referenceSource.getPages()) {
    urls.add(referenceUrl(page.slugs));
  }
  const out: ResolvedLivePage[] = [];
  for (const url of urls) {
    const live = resolveLivePage(url.split("/").filter(Boolean));
    if (live && live.canonical === url) out.push(live);
  }
  return out;
}
