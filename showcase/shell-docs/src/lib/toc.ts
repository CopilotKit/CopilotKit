// Right-rail "On this page" TOC. Extracts H2/H3 headings from rendered
// MDX source (post-snippet-inlining) so the TOC surfaces the page's
// actual sections, including anything pulled in from shared snippets.
//
// Slug algorithm matches the conventional GitHub/rehype-slug behavior
// closely enough for same-page anchors. Duplicate handling is kept
// intentionally minimal — a scan of showcase/shell-docs content shows
// no H2 collisions today; if that changes, swap in rehype-slug.

import { getIntegration } from "./registry";

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

// Strip `<WhenFrameworkHas>` blocks from the MDX source whose gate would
// not render given the current framework, so headings inside non-matching
// branches don't leak into the right-rail TOC.
//
// Mirrors the runtime evaluation in `components/when-framework-has.tsx`:
//
//   - `<WhenFrameworkHas flag="X" equals="Y">…</WhenFrameworkHas>` is
//     kept only when `integration[X] === "Y"`.
//   - `<WhenFrameworkHas flag="X" absent>…</WhenFrameworkHas>` is kept
//     only when `integration[X]` is null/missing.
//   - When `framework` is null/undefined or the integration can't be
//     resolved, every gated block is stripped (matches the runtime
//     behavior — `WhenFrameworkHas` returns null with no framework).
//
// Blocks in the showcase content are flat (no nesting), so a simple
// linear scan of `<WhenFrameworkHas ...>` / `</WhenFrameworkHas>` pairs
// is sufficient. If nested gates appear in the future, this needs a
// real parser — but the runtime component is single-level too, so the
// constraint is consistent on both sides.
export function filterFrameworkScopedBlocks(
  source: string,
  framework: string | null | undefined,
): string {
  const integration = framework ? getIntegration(framework) : undefined;
  const flags = integration
    ? (integration as unknown as Record<string, unknown>)
    : null;

  const openRe = /<WhenFrameworkHas\b([^>]*)>/g;
  const closeTag = "</WhenFrameworkHas>";

  const out: string[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = openRe.exec(source)) !== null) {
    const openStart = match.index;
    const openEnd = openRe.lastIndex;
    const attrs = match[1];

    // Append everything between the previous cursor and this opener.
    out.push(source.slice(cursor, openStart));

    // Find the matching closer. Flat-only — first closer after this
    // opener is the pair.
    const closeIdx = source.indexOf(closeTag, openEnd);
    if (closeIdx === -1) {
      // Malformed source — bail out and emit the remainder unchanged
      // so we don't drop content silently.
      out.push(source.slice(openStart));
      cursor = source.length;
      break;
    }
    const blockEnd = closeIdx + closeTag.length;
    const inner = source.slice(openEnd, closeIdx);

    const flagMatch = attrs.match(/\bflag\s*=\s*"([^"]+)"/);
    const equalsMatch = attrs.match(/\bequals\s*=\s*"([^"]+)"/);
    const isAbsent = /\babsent\b/.test(attrs);

    let keep = false;
    if (flagMatch && flags) {
      const value = flags[flagMatch[1]];
      if (isAbsent) {
        keep = value == null;
      } else if (equalsMatch) {
        keep = value === equalsMatch[1];
      }
    }

    if (keep) {
      // Preserve the inner content but drop the surrounding tags so a
      // stray opener/closer can't confuse a recursive caller.
      out.push(inner);
    }

    cursor = blockEnd;
    openRe.lastIndex = blockEnd;
  }

  out.push(source.slice(cursor));
  return out.join("");
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
