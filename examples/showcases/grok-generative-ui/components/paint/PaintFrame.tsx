/* =========================================================================
 * Paint-In Loading — React API
 * -------------------------------------------------------------------------
 * Drop-in components and hooks that walk any React subtree through a
 * three-phase reveal:
 *
 *   skeleton (dashed indigo + label)  →  wireframe (placeholder)  →  rendered
 *
 * Pure React + CSS. No agent framework, no protocol, no design system
 * required. Just import `paint-loading.css` once at app root.
 *
 * Exports:
 *   - <PaintSurface>     outer frame, optional auto-stagger
 *   - <PaintFrame>       per-node wrapper
 *   - <PaintStagger>     auto-stagger inside non-Surface containers
 *   - usePaintPhase()    hook for managing phase progression yourself
 *   - estimatePaintMs()  total-budget helper for external timers
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

    // Respect prefers-reduced-motion: skip the phase walk and land directly
    // on "rendered". The CSS @media block disables transitions anyway, so
    // walking the phases just adds delay without any reveal animation.
    // lockPhase always wins so Suspense fallbacks still pin to wireframe.
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setPhase("rendered");
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

/* ── estimatePaintMs ────────────────────────────────────────────────── */

export interface EstimatePaintMsOptions {
  /** Number of <PaintFrame>s under the surface (count of mounted frames,
   *  not nesting depth). The last frame starts at (frameCount - 1) * step. */
  frameCount: number;
  /** Per-sibling stagger gap. Default 180 ms (matches PaintSurface default). */
  staggerStep?: number;
  /** Skeleton → wireframe duration. Default 140 ms. */
  phaseSkeletonMs?: number;
  /** Wireframe → rendered duration. Default 160 ms. */
  phaseWireframeMs?: number;
}

/**
 * Total animation budget from first frame's skeleton-start to last frame's
 * rendered phase. Useful for external code that needs to know when the
 * paint-in finishes — e.g. a parent that flips `mode` from "building" to ""
 * once the animation completes.
 *
 * Formula: `(frameCount - 1) * staggerStep + phaseSkeletonMs + phaseWireframeMs`
 *
 * Prefer this helper over inlining the formula — it'll stay in sync with
 * the defaults if they shift in a future version.
 *
 * @example
 *   const total = estimatePaintMs({ frameCount: 8, staggerStep: 130 });
 *   setTimeout(() => agent.setState({ mode: "" }), total);
 */
export function estimatePaintMs({
  frameCount,
  staggerStep = 180,
  phaseSkeletonMs = 140,
  phaseWireframeMs = 160,
}: EstimatePaintMsOptions): number {
  const lastStart = Math.max(0, frameCount - 1) * staggerStep;
  return lastStart + phaseSkeletonMs + phaseWireframeMs;
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
  /** Outer element tag. Default "div". Use a semantic tag (e.g. "section")
   *  when the surface represents a labeled region in the page outline. */
  as?: ElementType;
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
      as,
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
    // delays across re-renders. Note: this means dynamically inserting a new
    // <PaintFrame> after first paint is *not* auto-staggered — it'd get
    // delay=0 because PaintFrame's resolved delay is memoized on [id]. Pass
    // an explicit `delay` prop to any frame inserted after the initial
    // mount.
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

    const Tag = (as ?? "div") as ElementType;

    return (
      <Tag
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
      </Tag>
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
  /** Strip the wrapper's own padding / background / border / shadow at the
   *  rendered phase so a pre-styled child (e.g. an existing <ChartCard>
   *  with its own card chrome) doesn't double-stack visuals. Skeleton +
   *  wireframe still draw the normal placeholder footprint — only the
   *  rendered phase steps out of the way. See examples.md § 9. */
  ghostRender?: boolean;
  /** When true, swap `opacity: 0` for `display: none` on the children
   *  during skeleton/wireframe. Defers any mount-time animation on the
   *  child (e.g. a chart reveal that fires once on first paint) until
   *  the rendered phase, so the user sees the animation rather than it
   *  completing behind the placeholder. Tradeoff: the child re-mounts on
   *  the skeleton→rendered transition and may cause a brief layout shift
   *  if its rendered footprint differs from the wireframe placeholder. */
  deferChildren?: boolean;
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
  ghostRender = false,
  deferChildren = false,
  as,
  className,
  style,
  children,
  ...rest
}: PaintFrameProps<E> &
  Omit<ComponentPropsWithoutRef<E>, keyof PaintFrameProps<E>>) {
  const ctx = useContext(SurfaceContext);

  // Resolve delay once per (frame instance × surface) so re-renders don't
  // shift the timeline. Caveat: surface stepCounter resets each render, so
  // a <PaintFrame> dynamically inserted after first paint will silently
  // get delay=0 because this useMemo keys off [id]. Pass an explicit
  // `delay` prop for any frame inserted later.
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
        ghostRender && "paint-node--ghost-render",
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
      {/* deferChildren swaps the opacity-0 fade for unmount, so any mount-
       * time animation on the child fires when it actually becomes visible
       * rather than completing behind the placeholder. */}
      {deferChildren && phase !== "rendered" ? null : (
        <span className="paint-children">{children}</span>
      )}
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
