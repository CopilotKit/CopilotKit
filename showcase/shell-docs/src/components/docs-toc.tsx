"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TocHeading } from "@/lib/toc";

export interface DocsTocProps {
  headings: TocHeading[];
}

interface SvgState {
  path: string;
  width: number;
  height: number;
}

interface ThumbState {
  top: number;
  height: number;
  visible: boolean;
}

// useLayoutEffect on the server warns; swap to useEffect during SSR.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Right-rail TOC. Hidden below xl (1280px) because the main column
// already fills most of the viewport at laptop widths.
//
// This is a 1:1 port of fumadocs-ui's "clerk" TOC variant
// (@fumadocs/ui/dist/components/toc/clerk.js): persistent gray vertical
// lines per item, diagonal SVG connectors at depth changes, and a
// violet thumb that slides behind an SVG mask. The mask is the union
// of every item's vertical line segment, so the violet pill paints
// only along the line path of the active heading.
//
// Color tokens kept literal to match canonical's `--color-fd-primary`
// (#7076D5). Inactive line uses `currentColor/10` via class names.
function getItemOffset(depth: number): number {
  if (depth <= 2) return 14;
  if (depth === 3) return 26;
  return 36;
}

function getLineOffset(depth: number): number {
  return depth >= 3 ? 10 : 0;
}

export function DocsToc({ headings }: DocsTocProps) {
  const [activeSlug, setActiveSlug] = useState<string | null>(
    headings[0]?.slug ?? null,
  );
  const [svg, setSvg] = useState<SvgState | null>(null);
  const [thumb, setThumb] = useState<ThumbState>({
    top: 0,
    height: 0,
    visible: false,
  });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const linkRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  // Scroll-spy: pick the last heading whose top has crossed the
  // trigger line (~25% from viewport top), with an explicit
  // scrollMax override so the last heading is active when the user
  // hits the bottom of the page. IntersectionObserver alone doesn't
  // cover this case — once the last heading has scrolled past the
  // trigger band, no entry fires "intersecting" so the previous
  // active stays selected even though the user has clearly arrived
  // at the last section.
  useEffect(() => {
    if (headings.length === 0) return;

    // The actual scroll happens on `.docs-content-wrapper` (canonical
    // page architecture: body has `overflow: hidden`). Fall back to
    // window for safety on routes that don't wrap content this way.
    const scrollEl =
      document.querySelector<HTMLElement>(".docs-content-wrapper") ?? null;

    const update = () => {
      const triggerY = window.innerHeight * 0.25;
      let activeIdx = 0;
      for (let i = 0; i < headings.length; i++) {
        const el = document.getElementById(headings[i].slug);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= triggerY) {
          activeIdx = i;
        }
      }
      if (scrollEl) {
        const atBottom =
          scrollEl.scrollTop + scrollEl.clientHeight >=
          scrollEl.scrollHeight - 4;
        if (atBottom) activeIdx = headings.length - 1;
      } else {
        const docEl = document.documentElement;
        const atBottom =
          window.scrollY + window.innerHeight >= docEl.scrollHeight - 4;
        if (atBottom) activeIdx = headings.length - 1;
      }
      setActiveSlug(headings[activeIdx]?.slug ?? null);
    };

    update();
    const target: HTMLElement | Window = scrollEl ?? window;
    target.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      target.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [headings]);

  // Build the SVG mask path by tracing each item's vertical line
  // segment. Mirrors clerk.js `onResize`.
  useIsoLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onResize = () => {
      if (container.clientHeight === 0) return;
      let w = 0;
      let h = 0;
      const d: string[] = [];
      for (let i = 0; i < headings.length; i++) {
        const element = linkRefs.current.get(headings[i].slug);
        if (!element) continue;
        const styles = getComputedStyle(element);
        const offset = getLineOffset(headings[i].depth) + 1;
        const top = element.offsetTop + parseFloat(styles.paddingTop);
        const bottom =
          element.offsetTop +
          element.clientHeight -
          parseFloat(styles.paddingBottom);
        w = Math.max(offset, w);
        h = Math.max(h, bottom);
        d.push(`${i === 0 ? "M" : "L"}${offset} ${top}`);
        d.push(`L${offset} ${bottom}`);
      }
      setSvg({ path: d.join(" "), width: w + 1, height: h });
    };

    onResize();
    const observer = new ResizeObserver(onResize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [headings]);

  // Track the active item's geometry so the thumb (the violet pill
  // behind the mask) animates between segments.
  useIsoLayoutEffect(() => {
    if (!activeSlug) {
      setThumb((s) => ({ ...s, visible: false }));
      return;
    }
    const container = containerRef.current;
    const link = linkRefs.current.get(activeSlug);
    if (!container || !link) return;

    const measure = () => {
      setThumb({
        top: link.offsetTop,
        height: link.clientHeight,
        visible: true,
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(measure).catch(() => {});
    }
    return () => ro.disconnect();
  }, [activeSlug, headings]);

  if (headings.length === 0) return null;

  const maskUrl = svg
    ? `url("data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svg.width} ${svg.height}"><path d="${svg.path}" stroke="black" stroke-width="1" fill="none"/></svg>`,
      )}")`
    : undefined;

  return (
    <aside className="hidden xl:block w-[220px] shrink-0 sticky top-0 self-start max-h-[calc(100vh-100px)] overflow-y-auto py-8 pl-6 pr-4">
      <div className="text-[13px] font-medium text-[var(--text-secondary)] mb-3">
        On this page
      </div>
      <div className="relative">
        {svg && maskUrl && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0"
            style={{
              width: svg.width,
              height: svg.height,
              WebkitMaskImage: maskUrl,
              maskImage: maskUrl,
            }}
          >
            <span
              className="absolute w-full"
              style={{
                top: thumb.top,
                height: thumb.height,
                opacity: thumb.visible ? 1 : 0,
                background: "#7076D5",
                transition:
                  "top 220ms cubic-bezier(0.4,0,0.2,1), height 220ms cubic-bezier(0.4,0,0.2,1), opacity 120ms ease",
              }}
            />
          </div>
        )}
        <div
          ref={containerRef}
          className="relative flex flex-col text-[13px] leading-[1.55]"
        >
          {headings.map((h, i) => {
            const isActive = activeSlug === h.slug;
            const upperDepth = headings[i - 1]?.depth ?? h.depth;
            const lowerDepth = headings[i + 1]?.depth ?? h.depth;
            const offset = getLineOffset(h.depth);
            const upperOffset = getLineOffset(upperDepth);
            const lowerOffset = getLineOffset(lowerDepth);
            const padStart = getItemOffset(h.depth);
            const lineTopAdjust = offset !== upperOffset;
            const lineBottomAdjust = offset !== lowerOffset;

            return (
              <a
                key={h.slug}
                ref={(el) => {
                  if (el) linkRefs.current.set(h.slug, el);
                  else linkRefs.current.delete(h.slug);
                }}
                href={`#${h.slug}`}
                data-active={isActive}
                onClick={() => setActiveSlug(h.slug)}
                className="relative py-1.5 transition-colors"
                style={{
                  paddingInlineStart: padStart,
                  color: isActive ? "#7076D5" : "var(--text-muted)",
                }}
              >
                {/* Diagonal connector when this item's depth differs
                 * from the previous sibling's. */}
                {offset !== upperOffset && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    className="absolute -top-1.5 left-0 size-4"
                  >
                    <line
                      x1={upperOffset}
                      y1="0"
                      x2={offset}
                      y2="12"
                      className="stroke-black/10 dark:stroke-white/10"
                      strokeWidth="1"
                    />
                  </svg>
                )}
                {/* Faint vertical line. Trimmed at top/bottom edges
                 * when the depth changes, so the diagonal connector
                 * meets it cleanly. */}
                <span
                  aria-hidden="true"
                  className="absolute w-px bg-black/10 dark:bg-white/10"
                  style={{
                    insetInlineStart: offset,
                    top: lineTopAdjust ? 6 : 0,
                    bottom: lineBottomAdjust ? 6 : 0,
                  }}
                />
                {h.text}
              </a>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
