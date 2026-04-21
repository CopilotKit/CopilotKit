// Shared helpers for walking the `src/content/reference/` tree. Used by
// both /reference (index page) and /reference/[...slug] so the two stay
// in sync: same subdirs, same recursive traversal, same gray-matter
// handling, same caching behavior.

import fs from "fs";
import path from "path";
import matter from "gray-matter";

export const REFERENCE_CONTENT_DIR = path.join(
  process.cwd(),
  "src/content/reference",
);

// Top-level reference categories we index. Anything outside this list is
// ignored (e.g. a stray snippet file at the root).
export const REFERENCE_SUBDIRS = ["components", "hooks"] as const;
export type ReferenceSubdir = (typeof REFERENCE_SUBDIRS)[number];

export type ReferenceItem = {
  /** subdir-relative slug, e.g. `components/chat` or `components/inputs/textarea`. */
  slug: string;
  title: string;
  description?: string;
  category: "Components" | "Hooks";
};

function categoryFor(subdir: ReferenceSubdir): "Components" | "Hooks" {
  return subdir === "components" ? "Components" : "Hooks";
}

/**
 * Recursively collect all `.mdx` files under `dir` and return their paths
 * relative to `dir` (without the `.mdx` extension). Silently skips
 * unreadable subdirectories so a single EACCES doesn't break the build.
 */
function walkMdx(dir: string, prefix: string = ""): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`[reference-items] Failed to read dir ${dir}:`, err);
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const childAbs = path.join(dir, entry.name);
    const childRel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walkMdx(childAbs, childRel));
    } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
      out.push(childRel.replace(/\.mdx$/, ""));
    }
  }
  return out;
}

/**
 * Load items from a single reference subdir, recursing into subfolders.
 * Malformed frontmatter on any file is logged and skipped — we never
 * crash the whole index just because one page has a bad YAML block.
 */
function loadSubdirItems(subdir: ReferenceSubdir): ReferenceItem[] {
  const dir = path.join(REFERENCE_CONTENT_DIR, subdir);
  if (!fs.existsSync(dir)) return [];

  const items: ReferenceItem[] = [];
  for (const relSlug of walkMdx(dir)) {
    const filePath = path.join(dir, `${relSlug}.mdx`);
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      console.error(`[reference-items] Failed to read ${filePath}:`, err);
      continue;
    }
    let data: Record<string, unknown> = {};
    try {
      ({ data } = matter(raw));
    } catch (err) {
      console.error(
        `[reference-items] Failed to parse frontmatter in ${filePath}:`,
        err,
      );
      continue;
    }
    const fallbackTitle = relSlug.split("/").pop() ?? relSlug;
    items.push({
      slug: `${subdir}/${relSlug}`,
      title:
        typeof data.title === "string" && data.title.length > 0
          ? data.title
          : fallbackTitle,
      description:
        typeof data.description === "string" ? data.description : undefined,
      category: categoryFor(subdir),
    });
  }
  return items;
}

/**
 * In-memory reference-item cache. Populated lazily on first access per
 * subdir and never invalidated for the life of the Node process.
 *
 * Lifecycle assumptions:
 *   - Production: a single `next start` boot caches once and serves cached
 *     items until the process exits. Next.js redeploys spin up a new
 *     process, so a fresh cache is a natural boundary — same as the
 *     title/meta caches in docs-render.tsx.
 *   - Dev: `isProd()` returns false, so both the read and write paths
 *     skip the cache and every render reopens the MDX files. This is the
 *     only way MDX edits show up without a server restart.
 *
 * Fragility note: a deployment that uses ISR / on-demand revalidation
 * against this module would serve stale items forever because nothing
 * clears the map. If we ever add ISR to /reference routes, refactor this
 * to key on mtime or add an explicit invalidation hook. For the current
 * `next start` deployment, the one-shot cache is correct.
 */
const __itemsCache = new Map<ReferenceSubdir, ReferenceItem[]>();
function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

export function loadReferenceItems(subdir: ReferenceSubdir): ReferenceItem[] {
  if (isProd()) {
    const cached = __itemsCache.get(subdir);
    if (cached) return cached;
  }
  const items = loadSubdirItems(subdir);
  if (isProd()) __itemsCache.set(subdir, items);
  return items;
}

export function loadAllReferenceItems(): ReferenceItem[] {
  return REFERENCE_SUBDIRS.flatMap((s) => loadReferenceItems(s));
}

/**
 * For `generateStaticParams`: return every reference page as its Next.js
 * catch-all slug array. Recursive (unlike the previous one-level-only
 * implementation), so subfolder docs like `components/inputs/textarea`
 * are statically generated too.
 */
export function referenceStaticParams(): { slug: string[] }[] {
  return loadAllReferenceItems().map((item) => ({
    slug: item.slug.split("/"),
  }));
}
