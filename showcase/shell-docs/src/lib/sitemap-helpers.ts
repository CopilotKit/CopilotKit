// Helpers for assembling the sitemap.ts route. Kept separate from the
// route file so the walking logic can be unit-tested and reused without
// pulling in the Next.js MetadataRoute types.
//
// The sitemap covers four URL families:
//   1. Bare unscoped docs   — /<slug>           (excluding integrations/ trees)
//   2. Framework-scoped     — /<framework>/<slug>
//   3. Reference docs       — /reference/<slug> (from src/content/reference)
//   4. AG-UI                — /ag-ui/<slug>
//
// Each entry's `lastModified` is resolved from MDX frontmatter `lastmod`
// when present, falling back to the file's mtime, then `new Date()`.

import fs from "fs";
import path from "path";
import matter from "gray-matter";

export const DOCS_CONTENT_DIR = path.join(process.cwd(), "src/content/docs");
export const REFERENCE_CONTENT_DIR = path.join(
  process.cwd(),
  "src/content/reference",
);
export const AG_UI_CONTENT_DIR = path.join(process.cwd(), "src/content/ag-ui");

export interface MdxEntry {
  /** URL slug (no leading slash, route groups stripped, trailing /index dropped). */
  slug: string;
  /** Absolute path to the source MDX file. */
  filePath: string;
}

/**
 * Convert a filesystem-relative MDX path into the URL slug the docs
 * router actually serves. Two normalizations:
 *
 *   1. Drop `(name)` route-group segments — `(other)/contributing/foo`
 *      is reachable at `/contributing/foo` and that is the canonical
 *      URL for it.
 *   2. Strip a trailing `/index` segment so a `dir/index.mdx` file
 *      becomes `dir`, matching the directory-as-page semantics in
 *      docs-render.
 *
 * Returns an empty string when every segment was a route group or
 * the entire path was a top-level `index`. Callers should treat that
 * as the root and skip emitting a duplicate.
 */
function normalizeSlugForUrl(slug: string): string {
  const parts = slug.split("/").filter((seg) => !/^\(.+\)$/.test(seg));
  if (parts.length > 0 && parts[parts.length - 1] === "index") {
    parts.pop();
  }
  return parts.join("/");
}

/**
 * Recursively collect all `.mdx` files under `dir`, returning URL
 * slugs (route-group segments stripped, trailing /index dropped) and
 * the absolute filesystem path. Silently skips unreadable
 * subdirectories so a single EACCES doesn't break the build.
 *
 * `ignoreSegments` lets the caller skip whole subtrees by their first
 * path segment (e.g. "integrations" when collecting bare unscoped pages).
 *
 * Slugs are deduplicated within a single call — two filesystem paths
 * that collapse to the same URL (e.g. `foo.mdx` and `(group)/foo.mdx`)
 * yield only the first one walked.
 */
export function walkMdx(
  dir: string,
  ignoreSegments: ReadonlySet<string> = new Set(),
): MdxEntry[] {
  const seen = new Set<string>();
  const out: MdxEntry[] = [];

  function recurse(absDir: string, prefix: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (!prefix && ignoreSegments.has(entry.name)) continue;
      const childAbs = path.join(absDir, entry.name);
      const childRel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        recurse(childAbs, childRel);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".mdx") &&
        entry.name !== "meta.json"
      ) {
        const rawSlug = childRel.replace(/\.mdx$/, "");
        const slug = normalizeSlugForUrl(rawSlug);
        if (seen.has(slug)) continue;
        seen.add(slug);
        out.push({ slug, filePath: childAbs });
      }
    }
  }

  recurse(dir, "");
  return out;
}

/**
 * Resolve a `lastModified` Date for a given MDX file. Order:
 *   1. Frontmatter `lastmod` (parsed by gray-matter; can be a Date or
 *      ISO string).
 *   2. File mtime from the filesystem.
 *   3. `new Date()` as a final fallback.
 */
export function resolveLastModified(absFilePath: string): Date {
  try {
    const raw = fs.readFileSync(absFilePath, "utf-8");
    const { data } = matter(raw);
    const lm = (data as Record<string, unknown>).lastmod;
    if (lm instanceof Date && !isNaN(lm.getTime())) return lm;
    if (typeof lm === "string") {
      const d = new Date(lm);
      if (!isNaN(d.getTime())) return d;
    }
  } catch {
    // Fall through to mtime.
  }
  try {
    return fs.statSync(absFilePath).mtime;
  } catch {
    return new Date();
  }
}

/**
 * Bare unscoped docs: every `.mdx` under `src/content/docs/` excluding
 * the `integrations/` subtree (framework-specific overrides). The
 * empty-slug entry (top-level index, if any) is filtered out so the
 * root URL is emitted only once by the caller.
 */
export function getBareDocsPages(): MdxEntry[] {
  return walkMdx(DOCS_CONTENT_DIR, new Set(["integrations"])).filter(
    (e) => e.slug.length > 0,
  );
}

/**
 * Per-framework override pages under `src/content/docs/integrations/<folder>/`.
 * Returns slug paths relative to the framework folder (e.g. "quickstart",
 * "advanced-configuration") plus their absolute file paths.
 */
export function getFrameworkOverridePages(folder: string): MdxEntry[] {
  const dir = path.join(DOCS_CONTENT_DIR, "integrations", folder);
  if (!fs.existsSync(dir)) return [];
  return walkMdx(dir).filter((e) => e.slug.length > 0);
}

/**
 * Reference docs under `src/content/reference/`. These power the
 * `/reference/[...slug]` route (distinct from the `/reference/v1/*`
 * and `/reference/v2/*` MDX that lives under `src/content/docs/`).
 */
export function getReferencePages(): MdxEntry[] {
  if (!fs.existsSync(REFERENCE_CONTENT_DIR)) return [];
  return walkMdx(REFERENCE_CONTENT_DIR).filter((e) => e.slug.length > 0);
}

/**
 * AG-UI pages under `src/content/ag-ui/`.
 */
export function getAgUiPages(): MdxEntry[] {
  if (!fs.existsSync(AG_UI_CONTENT_DIR)) return [];
  return walkMdx(AG_UI_CONTENT_DIR).filter((e) => e.slug.length > 0);
}

/**
 * Resolve the canonical base URL. Reads `NEXT_PUBLIC_BASE_URL` (set in
 * production to `https://docs.copilotkit.ai`) and strips any trailing
 * slash so callers can concatenate `${BASE}/${path}` safely. Falls back
 * to the production host so SSG always yields absolute URLs even when
 * the env var hasn't been wired yet.
 */
export function getBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_URL || "https://docs.copilotkit.ai";
  return raw.replace(/\/+$/, "");
}
