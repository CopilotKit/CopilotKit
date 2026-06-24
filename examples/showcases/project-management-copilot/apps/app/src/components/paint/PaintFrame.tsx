/* =========================================================================
 * Paint-In Loading — React API
 * -------------------------------------------------------------------------
 * Drop-in components and hooks that walk any React subtree through a
 * three-phase reveal:
 *
 *   skeleton (dashed indigo + label)  →  wireframe (placeholder)  →  rendered
 *
 * Pure React + CSS. No agent framework, no protocol, no design system
 * required. The companion paint-loading.css is imported once from main.tsx.
 *
 * Exports:
 *   - <PaintSurface>     outer frame, optional auto-stagger
 *   - <PaintFrame>       per-node wrapper
 *   - <PaintStagger>     auto-stagger inside non-Surface containers
 *   - usePaintPhase()    hook for managing phase progression yourself
 *   - PaintPhase, PaintSurfaceTheme   types
 * =========================================================================*/

import {
  Children,
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  ComponentPropsWithoutRef,
  ElementType,
  ReactElement,
  ReactNode,
} from "react";

/* ── Types ──────────────────────────────────────────────────────────── */

export type PaintPhase = "skeleton" | "wireframe" | "rendered";

export type PaintSurfaceTheme = "viewer" | "transparent" | "none";

interface SurfaceCtx {
  /** Increments each time `nextDelay()` is called, so siblings auto-stagger. */
  nextDelay: () => number;
  /** Tells the surface that at least one descendant has reached "rendered". */
  notifyRendered: () => void;
  staggerStep: number;
  defaultPhaseSkeletonMs: number;
  defaultPhaseWireframeMs: number;
}

const SurfaceContext = createContext<SurfaceCtx | null>(null);

/* ── usePaintPhase ──────────────────────────────────────────────────── */

export interface UsePaintPhaseOptions {
  delay?: number;
  phaseSkeletonMs?: number;
  phaseWireframeMs?: number;
  lockPhase?: PaintPhase | null;
}

export function usePaintPhase({
  delay = 0,
  phaseSkeletonMs = 140,
  phaseWireframeMs = 160,
  lockPhase = null,
}: UsePaintPhaseOptions = {}): PaintPhase {
  const [phase, setPhase] = useState<PaintPhase>(lockPhase ?? "skeleton");

  useEffect(() => {
    if (lockPhase) {
      setPhase(lockPhase);
      return;
    }

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    setPhase("skeleton");

    const t1 = setTimeout(
      () => {
        if (cancelled) return;
        setPhase("wireframe");
        const t2 = setTimeout(() => {
          if (cancelled) return;
          setPhase("rendered");
        }, phaseWireframeMs);
        timers.push(t2);
      },
      Math.max(0, delay) + phaseSkeletonMs,
    );
    timers.push(t1);

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [delay, phaseSkeletonMs, phaseWireframeMs, lockPhase]);

  return phase;
}

/* ── PaintSurface ───────────────────────────────────────────────────── */

export interface PaintSurfaceProps extends ComponentPropsWithoutRef<"div"> {
  theme?: PaintSurfaceTheme;
  showMeta?: boolean;
  surfaceId?: string;
  autoStagger?: boolean;
  staggerStep?: number;
  phaseSkeletonMs?: number;
  phaseWireframeMs?: number;
}

export const PaintSurface = forwardRef<HTMLDivElement, PaintSurfaceProps>(
  function PaintSurface(
    {
      theme = "viewer",
      showMeta = false,
      surfaceId = "default",
      autoStagger = true,
      staggerStep = 180,
      phaseSkeletonMs = 140,
      phaseWireframeMs = 160,
      children,
      className,
      style,
      ...rest
    },
    ref,
  ) {
    const [renderedCount, setRenderedCount] = useState(0);
    const stepCounter = useRef(0);

    // Reset stagger counter on each render so the same tree doesn't pile up
    // delays across re-renders.
    stepCounter.current = 0;

    const ctx = useMemo<SurfaceCtx>(
      () => ({
        nextDelay: () => {
          if (!autoStagger) return 0;
          const d = stepCounter.current * staggerStep;
          stepCounter.current += 1;
          return d;
        },
        notifyRendered: () => setRenderedCount((c) => c + 1),
        staggerStep,
        defaultPhaseSkeletonMs: phaseSkeletonMs,
        defaultPhaseWireframeMs: phaseWireframeMs,
      }),
      [autoStagger, staggerStep, phaseSkeletonMs, phaseWireframeMs],
    );

    const empty = renderedCount === 0;
    const nodeCount = countPaintFrames(children);

    return (
      <div
        ref={ref}
        className={joinClass("paint-surface", className)}
        data-theme={theme}
        data-empty={empty ? "true" : "false"}
        style={style}
        {...rest}
      >
        {showMeta && (
          <div className="paint-surface-meta" aria-hidden>
            <span className="paint-pill">surface: {surfaceId}</span>
            <span className="paint-pill">theme: {theme}</span>
            <span className="paint-pill">nodes: {nodeCount}</span>
          </div>
        )}
        <SurfaceContext.Provider value={ctx}>
          {children}
        </SurfaceContext.Provider>
      </div>
    );
  },
);

/* ── PaintFrame ─────────────────────────────────────────────────────── */

export interface PaintFrameProps<E extends ElementType = "div"> {
  /** Short component label shown in the floating tag (e.g. "Card", "Header",
   *  "KpiTile"). Free-form — any short string that reads well. */
  component: string;
  /** Per-instance ID shown in the tag and used for stable React keys. Must
   *  be unique within a single <PaintSurface>. */
  id: string;
  /** Skeleton start time in ms. Auto-resolved when inside an auto-staggered
   *  <PaintSurface>. */
  delay?: number;
  phaseSkeletonMs?: number;
  phaseWireframeMs?: number;
  /** Pin a phase — use "wireframe" for Suspense fallbacks. */
  lockPhase?: PaintPhase | null;
  /** Optional style hint. For component="Text": "title" | "eyebrow" | "kpi"
   *  | "body" | "muted". For component="Button": "ghost". For component=
   *  "Icon" or "Badge": "green" | "amber" | "red" | "pink". Custom variants
   *  get a CSS class for your own targeting. */
  variant?: string;
  /** Hide the floating Component·#id tag for this frame. */
  showLabel?: boolean;
  as?: E;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function PaintFrame<E extends ElementType = "div">({
  component,
  id,
  delay,
  phaseSkeletonMs,
  phaseWireframeMs,
  lockPhase = null,
  variant,
  showLabel = true,
  as,
  className,
  style,
  children,
  ...rest
}: PaintFrameProps<E> &
  Omit<ComponentPropsWithoutRef<E>, keyof PaintFrameProps<E>>) {
  const ctx = useContext(SurfaceContext);

  // Resolve delay once per (frame instance × surface) so re-renders don't
  // shift the timeline.
  const resolvedDelay = useMemo(() => {
    if (typeof delay === "number") return delay;
    if (ctx) return ctx.nextDelay();
    return 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const phase = usePaintPhase({
    delay: resolvedDelay,
    phaseSkeletonMs: phaseSkeletonMs ?? ctx?.defaultPhaseSkeletonMs ?? 140,
    phaseWireframeMs: phaseWireframeMs ?? ctx?.defaultPhaseWireframeMs ?? 160,
    lockPhase,
  });

  // Notify the surface when this frame first reaches "rendered" so the
  // surface can drop its dashed empty frame.
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (phase === "rendered" && !notifiedRef.current && ctx) {
      notifiedRef.current = true;
      ctx.notifyRendered();
    }
  }, [phase, ctx]);

  const Tag = (as ?? "div") as ElementType;

  // Component-specific data attribute for Text variant placeholder widths
  const isText = component === "Text";
  const dataTextVariant = isText && variant ? variant : undefined;

  return (
    <Tag
      className={joinClass(
        "paint-node",
        `paint-node--${component}`,
        variant && `paint-${component.toLowerCase()}--${variant}`,
        className,
      )}
      data-state={phase}
      data-mounted="true"
      data-id={id}
      data-text-variant={dataTextVariant}
      style={style}
      {...(rest as object)}
    >
      {showLabel && (
        <span className="paint-tag" aria-hidden>
          {component} · #{id}
        </span>
      )}
      <span className="paint-children">{children}</span>
    </Tag>
  );
}

/* ── PaintStagger ───────────────────────────────────────────────────── */

export interface PaintStaggerProps {
  startDelay?: number;
  step?: number;
  children: ReactNode;
}

/**
 * Walks direct children and assigns auto-incrementing `delay` props to
 * any <PaintFrame> it finds. Use inside containers that aren't a
 * <PaintSurface> but still want a local stagger sequence.
 */
export function PaintStagger({
  startDelay = 0,
  step = 180,
  children,
}: PaintStaggerProps) {
  let i = 0;
  return (
    <>
      {Children.map(children, (child) => {
        if (!isValidElement(child)) return child;
        if (child.type !== PaintFrame) return child;
        if (typeof (child.props as PaintFrameProps).delay === "number")
          return child;
        const cloned = cloneElement(child, {
          delay: startDelay + i * step,
        } as Partial<PaintFrameProps>);
        i += 1;
        return cloned;
      })}
    </>
  );
}

/* ── helpers ────────────────────────────────────────────────────────── */

function joinClass(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Recursively count <PaintFrame> descendants for showMeta's "nodes: N" pill. */
function countPaintFrames(node: ReactNode): number {
  let n = 0;
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === PaintFrame) n += 1;
    const c = (child as ReactElement<{ children?: ReactNode }>).props?.children;
    if (c) n += countPaintFrames(c);
  });
  return n;
}
