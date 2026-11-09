"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CATALOG_ID } from "@/a2ui/catalog/ids";
import { sampleFor, sampleOps } from "@/a2ui/catalog/samples";
import { StaticSurface } from "@/components/app/static-surface";
import { cn } from "@/lib/utils";

function useOps(name: string) {
  return useMemo(() => {
    const s = sampleFor(name);
    return s ? sampleOps(name, s, CATALOG_ID) : null;
  }, [name]);
}

/** Mount children only once the box is near the viewport (keeps the tile overview light). */
function useNearViewport<T extends Element>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && setNear(true),
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    // Fallback: mount everything shortly after load so full-page captures and fast scrolls never see blanks.
    const t = setTimeout(() => setNear(true), 1200 + Math.random() * 800);
    return () => {
      io.disconnect();
      clearTimeout(t);
    };
  }, [near]);
  return { ref, near };
}

/**
 * Tile preview: lays the sample out wider than the tile and shrinks it with a
 * transform, so a 260px tile shows a component laid out at ~330px. The scale
 * starts at `scale` and only ever steps down (never below `floor`) until the
 * whole component fits the tile height; anything still taller is top-aligned
 * and faded out at the bottom. Monotone steps keep it from oscillating.
 */
export function TilePreview({
  name,
  scale: base,
  floor,
  center,
}: {
  name: string;
  scale: number;
  floor: number;
  center?: boolean;
}) {
  const ops = useOps(name);
  const { ref, near } = useNearViewport<HTMLDivElement>();
  const [inner, setInner] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [innerH, setInnerH] = useState(0);
  const [scale, setScale] = useState(base);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setBox({ w: el.clientWidth, h: el.clientHeight });
      setScale(base);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, base]);

  useEffect(() => {
    if (!inner) return;
    const ro = new ResizeObserver(() => setInnerH(inner.offsetHeight));
    ro.observe(inner);
    return () => ro.disconnect();
  }, [inner]);

  const pad = 20;
  const avail = box.h - pad * 2;

  useEffect(() => {
    if (!innerH || avail <= 0) return;
    const fit = Math.max(floor, Math.min(base, avail / innerH));
    if (fit < scale - 0.01) setScale(fit);
  }, [innerH, avail, base, floor, scale]);

  const scaledH = innerH * scale;
  const overflow = scaledH > avail + 1;
  const top = overflow ? pad : Math.max(pad, (box.h - scaledH) / 2);
  const innerW = Math.max(0, (box.w - pad * 2) / scale);

  return (
    <div
      ref={ref}
      className="docs-tile-preview relative h-full w-full overflow-hidden"
      aria-hidden="true"
      inert
    >
      {near && ops && box.w > 0 ? (
        <div
          ref={setInner}
          data-preview-inner
          className={cn(
            "absolute left-1/2 origin-top",
            center && "flex justify-center",
            innerH ? "opacity-100" : "opacity-0",
          )}
          style={{
            width: innerW,
            top,
            transform: `translateX(-50%) scale(${scale})`,
          }}
        >
          <StaticSurface ops={ops as never} />
        </div>
      ) : null}
      {overflow ? (
        <div className="docs-tile-fade pointer-events-none absolute inset-x-0 bottom-0 h-16" />
      ) : null}
    </div>
  );
}

/** Full-size preview for the component page stage. */
export function StagePreview({
  name,
  intrinsic,
  wide,
}: {
  name: string;
  intrinsic?: boolean;
  wide?: boolean;
}) {
  const ops = useOps(name);
  if (!ops)
    return (
      <p className="text-sm text-muted-foreground">No sample for {name}.</p>
    );
  return (
    <div
      className={cn(
        intrinsic
          ? "w-fit max-w-full"
          : wide
            ? "w-full"
            : "w-full max-w-[560px]",
      )}
    >
      <StaticSurface ops={ops as never} />
    </div>
  );
}
