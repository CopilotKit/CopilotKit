// Right-rail "On this page" TOC. Extracts H2/H3 headings from rendered
// MDX source (post-snippet-inlining) so the TOC surfaces the page's
// actual sections, including anything pulled in from shared snippets.
//
// Slug algorithm matches the conventional GitHub/rehype-slug behavior
// closely enough for same-page anchors. Duplicate handling is kept
// intentionally minimal — a scan of showcase/shell-docs content shows
// no H2 collisions today; if that changes, swap in rehype-slug.

export interface TocHeading {
  depth: 2 | 3;
  text: string;
  slug: string;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Strip trivial inline markdown (bold/italic/code spans) from heading
// text so the rendered TOC labels read as plain prose rather than "** &
// `` scattered through them.
function plainHeadingText(raw: string): string {
  return raw
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .trim();
}

export function extractHeadings(source: string): TocHeading[] {
  const lines = source.split("\n");
  const headings: TocHeading[] = [];
  const slugCounts = new Map<string, number>();
  let inFence = false;
  let fenceChar: "`" | "~" | "" = "";

  for (const line of lines) {
    // Track fenced code blocks so `# comment` inside python/js samples
    // doesn't masquerade as a heading.
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as "`" | "~";
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
      } else if (fenceChar === marker) {
        inFence = false;
        fenceChar = "";
      }
      continue;
    }
    if (inFence) continue;

    const match = line.match(/^(#{2,3})\s+(.+?)\s*$/);
    if (!match) continue;
    const depth = match[1].length as 2 | 3;
    const text = plainHeadingText(match[2]);
    if (!text) continue;

    let slug = slugify(text);
    if (!slug) continue;
    const count = slugCounts.get(slug) ?? 0;
    slugCounts.set(slug, count + 1);
    if (count > 0) slug = `${slug}-${count}`;

    headings.push({ depth, text, slug });
  }

  return headings;
}

// Flatten React heading children to a plain string so we can reuse the
// slugify algorithm in the MDX `h2`/`h3` component overrides. Must match
// the transforms applied by extractHeadings() so IDs line up with the
// slugs surfaced in the TOC.
export function childrenToText(children: unknown): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(childrenToText).join("");
  if (
    children &&
    typeof children === "object" &&
    "props" in children &&
    typeof (children as { props: unknown }).props === "object"
  ) {
    const props = (children as { props: { children?: unknown } }).props;
    return childrenToText(props?.children);
  }
  return "";
}
