import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  CatalogRenderers,
  RendererProps,
} from "../../../../create-catalog";
import type { layoutDefinitions, LayoutProps } from "../definitions/layout";
import {
  INNER_PANEL_BG,
  backgroundColor,
  borderColor,
  panelBackground,
  textColor,
  radius,
  spacing,
  SHADOW_MD,
  SHADOW_SM,
  SHADOW_SOFT,
} from "../tokens";
import { useStandardStyles } from "../styles";
import { Lightbox, type LightboxImage } from "./media";
import { safeHref } from "../inline-markdown";

const ALIGN_CSS: Record<string, string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  baseline: "baseline",
  stretch: "stretch",
};
const JUSTIFY_CSS: Record<string, string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly",
};

function radiusStyle(value: LayoutProps["radius"]): React.CSSProperties {
  if (typeof value === "string" || typeof value === "number") {
    return { borderRadius: radius(value) };
  }
  if (value) {
    return {
      borderTopLeftRadius: radius(value.topLeft),
      borderTopRightRadius: radius(value.topRight),
      borderBottomLeftRadius: radius(value.bottomLeft),
      borderBottomRightRadius: radius(value.bottomRight),
    };
  }
  return {};
}

/** Map the shared layout props to CSS. Undefined props produce no CSS. */
export function layoutStyle(p: LayoutProps): React.CSSProperties {
  // Never emit undefined longhands next to a shorthand: React applies an
  // undefined `rowGap` as a removal, and clearing `row-gap` resets the `gap`
  // shorthand in real browsers (jsdom does not model this).
  return defined({
    display: p.inline ? "inline-flex" : "flex",
    alignItems: p.align ? ALIGN_CSS[p.align] : undefined,
    justifyContent: p.justify ? JUSTIFY_CSS[p.justify] : undefined,
    flexWrap: p.wrap,
    gap: spacing(p.gap) ?? (p.disableAutoSpacing ? 0 : undefined),
    rowGap: spacing(p.rowGap),
    columnGap: spacing(p.columnGap),
    padding: p.flush ? 0 : spacing(p.padding),
    background: backgroundColor(p.background),
    border: p.border
      ? `1px solid ${borderColor(p.borderColor ?? "default")}`
      : undefined,
    ...radiusStyle(p.radius),
    width: spacing(p.width),
    height: spacing(p.height),
    // Containers may shrink below their content and never exceed their parent.
    minWidth: spacing(p.minWidth ?? p.minSize) ?? 0,
    maxWidth: spacing(p.maxWidth ?? p.maxSize) ?? "100%",
    minHeight: spacing(p.minHeight ?? p.minSize),
    maxHeight: spacing(p.maxHeight ?? p.maxSize),
    flex: p.flex,
    aspectRatio: p.aspectRatio,
    overflow: p.scrollable ? "auto" : p.clip ? "hidden" : undefined,
    boxShadow: p.shadow ? SHADOW_SM : undefined,
    boxSizing: "border-box",
  });
}

/** Drop undefined entries so `extra` never erases a value set by layoutStyle. */
function defined(style: React.CSSProperties): React.CSSProperties {
  return Object.fromEntries(
    Object.entries(style).filter(([, v]) => v !== undefined),
  ) as React.CSSProperties;
}

type BuildChild = (id: string, basePath?: string) => React.ReactNode;

/**
 * Render a bound ChildList: static ids (strings) or, for a template
 * `{ componentId, path }`, the binder's `{ id, basePath }` entries, each
 * built with its basePath so relative bindings resolve per item.
 */
export function renderChildList(
  list: unknown,
  children: RendererProps["children"],
): React.ReactNode {
  if (!Array.isArray(list)) return null;
  // The catalog passes the surface's buildChild, which accepts a basePath.
  const build = children as BuildChild;
  return list.map((item: unknown, i: number) => {
    if (typeof item === "string") {
      return (
        <React.Fragment key={`${item}-${i}`}>{build(item)}</React.Fragment>
      );
    }
    if (item && typeof item === "object" && "id" in item) {
      const node = item as { id: string; basePath?: string };
      return (
        <React.Fragment key={`${node.id}-${node.basePath ?? ""}-${i}`}>
          {build(node.id, node.basePath)}
        </React.Fragment>
      );
    }
    return null;
  });
}

/** Alias of `renderChildList` (ids or expanded template entries). */
export const renderChildren = renderChildList;

// The binder hands absent props over as `null`, so test for both.
const hasGap = (p: LayoutProps) =>
  p.gap != null ||
  p.columnGap != null ||
  p.rowGap != null ||
  !!p.disableAutoSpacing;

/**
 * Dispatch `onVisible` once, the first time the element scrolls into view
 * No observer when the prop is absent.
 */
export function useVisibleOnce(
  ref: React.RefObject<HTMLElement | null>,
  onVisible: unknown,
): void {
  const fired = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (
      typeof onVisible !== "function" ||
      !el ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (fired.current) return;
      if (entries.some((e) => e.isIntersecting)) {
        fired.current = true;
        (onVisible as () => void)();
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, onVisible]);
}

/**
 * True inside a Card. Surfaces have exactly one bordered level (the
 * outer card); everything nested flattens into borderless columns or the
 * single near-white inner panel.
 */
export const CardNestingContext = createContext(false);
/**
 * Containers counted from the nearest Card (null outside any Card). The
 * rhythm: 16px between the groups directly inside a card or form, 8px inside a
 * group (label + control, caption + value).
 */
export const CardDistanceContext = createContext<number | null>(null);
function defaultGap(distance: number | null): string | undefined {
  return spacing(distance === null || distance === 0 ? 4 : 2);
}

/** The inner panel: 12px padding, 8px radius, no border, no shadow. */
function innerPanelStyle(p: LayoutProps): React.CSSProperties {
  return {
    padding: spacing(p.padding ?? 3),
    borderRadius: radius("md"),
    background: panelBackground(p.background) ?? INNER_PANEL_BG,
    border: "none",
    boxShadow: "none",
  };
}

type Extra = (p: any, nested: boolean) => React.CSSProperties;

const container =
  (extra?: Extra, attrs?: (p: any) => Record<string, string | undefined>) =>
  ({ props, children }: RendererProps<any>) => {
    useStandardStyles();
    const nested = useContext(CardNestingContext);
    const distance = useContext(CardDistanceContext);
    const ref = useRef<HTMLDivElement>(null);
    useVisibleOnce(ref, props.onVisible);
    return (
      <CardDistanceContext.Provider
        value={distance === null ? null : distance + 1}
      >
        <div
          ref={ref}
          data-a2ui-std=""
          role={props.role}
          {...(attrs ? attrs(props) : {})}
          style={{
            ...layoutStyle(props),
            ...(hasGap(props) ? {} : { gap: defaultGap(distance) }),
            // Inside a Card, background tokens use the lighter panel palette.
            ...(nested && props.background
              ? { background: panelBackground(props.background) }
              : {}),
            ...(extra ? defined(extra(props, nested)) : {}),
          }}
        >
          {renderChildren(props.children, children)}
        </div>
      </CardDistanceContext.Provider>
    );
  };

/**
 * Card: bordered at the top level, flattened when nested in another Card.
 * "section" never draws a box; "outline" always does.
 */
function cardStyle(p: any, nested: boolean): React.CSSProperties {
  // A section is a heading plus its content: no box, no fill, no padding.
  if (p.variant === "section") {
    return {
      flexDirection: "column",
      gap: hasGap(p) ? undefined : spacing(4),
      padding: p.padding != null ? spacing(p.padding) : 0,
      border: "none",
      boxShadow: "none",
      borderRadius: 0,
      background: p.background ? backgroundColor(p.background) : "transparent",
    };
  }
  const ownBackground =
    p.background ?? (p.variant === "soft" ? "surface-secondary" : undefined);
  // "outline" is boxed even inside another Card.
  if (nested && p.variant !== "outline") {
    const base: React.CSSProperties = {
      flexDirection: "column",
      gap: hasGap(p) ? undefined : spacing(3),
      border: "none",
      boxShadow: "none",
    };
    if (ownBackground && ownBackground !== "transparent") {
      return {
        ...base,
        ...innerPanelStyle({ ...p, background: ownBackground }),
      };
    }
    return { ...base, padding: 0, background: "transparent", borderRadius: 0 };
  }
  const sizePadding = { sm: 2, md: 4, lg: 6 }[
    (p.size as "sm" | "md" | "lg" | undefined) ?? "md"
  ];
  return {
    flexDirection: "column",
    gap: hasGap(p) ? undefined : spacing(4),
    padding: p.flush ? 0 : spacing(p.padding ?? sizePadding),
    borderRadius: radius(
      typeof p.radius === "object" ? undefined : (p.radius ?? "xl"),
    ),
    border:
      p.variant === "transparent"
        ? "none"
        : `1px solid ${borderColor(p.borderColor ?? "default")}`,
    background: backgroundColor(
      ownBackground ??
        (p.variant === "transparent" ? "transparent" : undefined),
    ),
    boxShadow:
      p.shadowStyle === "md"
        ? SHADOW_MD
        : p.shadowStyle === "sm"
          ? SHADOW_SM
          : p.shadowStyle === "none"
            ? "none"
            : p.variant === "elevated"
              ? SHADOW_SOFT
              : undefined,
  };
}

function Card({ props, children }: RendererProps<any>) {
  useStandardStyles();
  const nested = useContext(CardNestingContext);
  const ref = useRef<HTMLDivElement>(null);
  useVisibleOnce(ref, props.onVisible);
  // A section draws no box, so what it contains keeps its own nesting level.
  const section = props.variant === "section";
  return (
    <CardNestingContext.Provider value={section ? nested : true}>
      <CardDistanceContext.Provider value={0}>
        <div
          ref={ref}
          role={props.role}
          data-a2ui-std=""
          data-a2ui-card={nested ? "nested" : "top"}
          data-a2ui-card-variant={props.variant ?? undefined}
          style={{
            ...layoutStyle(props),
            ...defined(cardStyle(props, nested)),
          }}
        >
          {renderChildren(props.children, children)}
        </div>
      </CardDistanceContext.Provider>
    </CardNestingContext.Provider>
  );
}

/** Minimum column width that lets `columns` cards sit side by side. */
const GRID_MIN_TRACK_PX = 520;

/**
 * A numeric column count becomes an auto-fit template: at most `n` columns
 * (each track is at least 1/n of the row) that collapse towards one column
 * once a track would drop below ~260px (two columns) / 520px / n.
 */
export function gridTemplateColumns(p: {
  columns?: number | string;
  minChildWidth?: number | string;
  gap?: number | string;
  columnGap?: number | string;
}): string {
  if (typeof p.columns === "string") return p.columns;
  if (p.minChildWidth != null) {
    return `repeat(auto-fill, minmax(min(100%, ${spacing(p.minChildWidth)}), 1fr))`;
  }
  const n = Math.max(1, Math.floor(p.columns ?? 2));
  if (n === 1) return "minmax(0, 1fr)";
  const gap = spacing(p.columnGap ?? p.gap ?? 4);
  const minTrack = Math.round(Math.max(120, GRID_MIN_TRACK_PX / n));
  return `repeat(auto-fit, minmax(min(100%, max(${minTrack}px, calc((100% - ${n - 1} * ${gap}) / ${n}))), 1fr))`;
}

/**
 * Number of columns the nearest Grid currently renders: the measured track
 * count when available (auto-fit collapses towards one column on narrow
 * widths), else the numeric `columns` prop; undefined when unknown.
 */
const GridColumnsContext = createContext<number | undefined>(undefined);

/** Count the resolved tracks of a laid-out grid ("120px 120px" → 2). */
function measureTracks(el: HTMLElement): number | undefined {
  if (typeof getComputedStyle !== "function") return undefined;
  const tracks = getComputedStyle(el)
    .gridTemplateColumns.split(/\s+/)
    .filter(Boolean);
  // Only trust a fully resolved template (browsers report px tracks).
  return tracks.length > 0 && tracks.every((t) => /^[\d.]+px$/.test(t))
    ? tracks.length
    : undefined;
}

function Grid({ props, children }: RendererProps<any>) {
  useStandardStyles();
  const ref = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMeasured(measureTracks(el));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const declared =
    typeof props.columns === "number" ||
    (props.columns == null && props.minChildWidth == null)
      ? Math.max(1, Math.floor(props.columns ?? 2))
      : undefined;
  return (
    <GridColumnsContext.Provider value={measured ?? declared}>
      <div
        ref={ref}
        data-a2ui-std=""
        style={{
          ...layoutStyle(props),
          ...defined({
            display: "grid",
            gap: hasGap(props) ? undefined : spacing(4),
            gridTemplateColumns: gridTemplateColumns(props),
            gridTemplateRows:
              typeof props.rows === "number"
                ? `repeat(${props.rows}, auto)`
                : (props.rows as string | undefined),
          }),
        }}
      >
        {renderChildren(props.children, children)}
      </div>
    </GridColumnsContext.Provider>
  );
}

/**
 * A span covering every rendered column becomes `1 / -1` (full row) so it
 * never creates implicit tracks that overflow the grid; smaller spans stay
 * `span N`. Without a known column count the span is used as given.
 */
export function gridItemColumn(
  span: number | undefined,
  columns: number | undefined,
): string | undefined {
  if (!span) return undefined;
  if (columns != null && span >= columns) return "1 / -1";
  return `span ${span}`;
}

function GridItem({ props, children }: RendererProps<any>) {
  useStandardStyles();
  const columns = useContext(GridColumnsContext);
  return (
    <div
      data-a2ui-std=""
      style={{
        ...layoutStyle(props),
        ...defined({
          gridColumn: gridItemColumn(props.span, columns),
          gridRow: props.rowSpan ? `span ${props.rowSpan}` : undefined,
          flexDirection: "column",
        }),
      }}
    >
      {renderChildren(props.children, children)}
    </div>
  );
}

/**
 * Horizontal snap scroller with previous/next arrows and a bindable
 * `activeIndex`: setting it scrolls that slide into view, and scrolling
 * writes the snapped slide's index back.
 */
function Carousel({ props, children }: RendererProps<any>) {
  useStandardStyles();
  const nested = useContext(CardNestingContext);
  const scroller = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const snap: string = props.snap ?? "proximity";
  const showArrows = props.showArrows !== false;

  const slides = () =>
    Array.from(scroller.current?.children ?? []) as HTMLElement[];
  const update = () => {
    const el = scroller.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };
  const scrollTo = (index: number) => {
    const el = scroller.current;
    const target = slides()[index];
    if (!el || !target) return;
    el.scrollTo({
      left: target.offsetLeft - el.offsetLeft,
      behavior: "smooth",
    });
  };
  const nearest = () => {
    const el = scroller.current;
    if (!el) return 0;
    let best = 0;
    let bestDistance = Infinity;
    slides().forEach((slide, i) => {
      const distance = Math.abs(
        slide.offsetLeft - el.offsetLeft - el.scrollLeft,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    return best;
  };

  useEffect(update, []);
  useEffect(() => {
    if (typeof props.activeIndex === "number") scrollTo(props.activeIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.activeIndex]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScroll = () => {
    update();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const index = nearest();
      if (index !== props.activeIndex) props.setActiveIndex?.(index);
    }, 120);
  };

  const arrow = (direction: -1 | 1, enabled: boolean, label: string) => (
    <button
      type="button"
      aria-label={label}
      disabled={!enabled}
      onClick={(e) => {
        e.stopPropagation();
        scrollTo(Math.max(0, nearest() + direction));
      }}
      style={{
        position: "absolute",
        top: "50%",
        [direction < 0 ? "left" : "right"]: 4,
        transform: "translateY(-50%)",
        width: 32,
        height: 32,
        borderRadius: 9999,
        border: `1px solid ${borderColor("default")}`,
        background: backgroundColor("surface-elevated"),
        color: textColor("default"),
        boxShadow: SHADOW_SM,
        cursor: enabled ? "pointer" : "default",
        opacity: enabled ? 1 : 0,
        pointerEvents: enabled ? "auto" : "none",
        transition: "opacity .15s",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 16,
        lineHeight: 1,
        zIndex: 1,
      }}
    >
      {direction < 0 ? "‹" : "›"}
    </button>
  );

  return (
    <div style={{ position: "relative", width: "100%", minWidth: 0 }}>
      <div
        ref={scroller}
        data-a2ui-std=""
        data-a2ui-carousel=""
        role="region"
        aria-label={props.ariaLabel}
        onScroll={onScroll}
        style={{
          ...layoutStyle(props),
          ...(nested && props.background
            ? { background: panelBackground(props.background) }
            : {}),
          flexDirection: "row",
          gap: spacing(props.gap ?? 2),
          overflowX: "auto",
          scrollSnapType: snap === "none" ? undefined : `x ${snap}`,
          scrollbarWidth: "none",
        }}
      >
        {renderChildren(props.children, children)}
      </div>
      {showArrows
        ? arrow(-1, canPrev, props.previousLabel ?? "Previous")
        : null}
      {showArrows ? arrow(1, canNext, props.nextLabel ?? "Next") : null}
    </div>
  );
}

/**
 * Carousel slide with an image on top. Clicking the image opens a lightbox
 * over every media slide of the same carousel (DOM order, clicked one
 * selected); `href` or `action` on the slide take over the click instead.
 */
function CarouselMediaItem({ props, children }: RendererProps<any>) {
  const [open, setOpen] = useState<{
    images: LightboxImage[];
    index: number;
  } | null>(null);
  const width = { sm: 160, md: 240, lg: 320 }[
    (props.size as "sm" | "md" | "lg" | undefined) ?? "md"
  ];
  const href = typeof props.href === "string" ? safeHref(props.href) : null;
  const hasAction = typeof props.action === "function";
  const lightbox = props.lightbox !== false && !href && !hasAction;
  const onClick = (e: React.MouseEvent<HTMLElement>) => {
    if (href) {
      if (typeof window !== "undefined") {
        window.open(href, "_blank", "noopener,noreferrer");
      }
      return;
    }
    if (hasAction) {
      (props.action as () => void)();
      return;
    }
    if (!lightbox) return;
    const own = e.currentTarget;
    const scope =
      own.closest("[data-a2ui-carousel]") ?? own.parentElement?.parentElement;
    const slides = Array.from(
      scope?.querySelectorAll<HTMLImageElement>(
        "[data-a2ui-carousel-media] > img",
      ) ?? [],
    );
    const images = slides.map((img) => ({ src: img.src, alt: img.alt }));
    const index = Math.max(
      0,
      slides.findIndex((img) => img === own),
    );
    setOpen(
      images.length > 0
        ? { images, index }
        : { images: [{ src: String(props.media), alt: props.alt }], index: 0 },
    );
  };
  const clickable = lightbox || !!href || hasAction;
  return (
    <div
      data-a2ui-std=""
      data-a2ui-carousel-media=""
      style={{
        ...layoutStyle(props),
        flex: "0 0 auto",
        flexDirection: "column",
        scrollSnapAlign: "start",
        width,
        gap: spacing(props.gap ?? 2),
      }}
    >
      <img
        src={String(props.media)}
        alt={props.alt ?? ""}
        loading="lazy"
        onClick={clickable ? onClick : undefined}
        data-a2ui-lightbox-trigger={lightbox ? "" : undefined}
        style={{
          display: "block",
          width: "100%",
          aspectRatio: props.aspectRatio ?? "4 / 3",
          objectFit: "cover",
          borderRadius: radius("lg"),
          cursor: lightbox ? "zoom-in" : clickable ? "pointer" : undefined,
        }}
      />
      {renderChildren(props.children, children)}
      {open ? (
        <Lightbox
          images={open.images}
          index={open.index}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

const span = (p: { span?: number; rowSpan?: number }) => ({
  gridColumn: p.span ? `span ${p.span}` : undefined,
  gridRow: p.rowSpan ? `span ${p.rowSpan}` : undefined,
});

export const layoutRenderers = {
  Box: container((p, nested) => ({
    flexDirection: p.direction === "row" ? "row" : "column",
    // A bordered Box inside a Card becomes the inner panel, not a 1px box.
    ...(nested && p.border ? innerPanelStyle(p) : {}),
  })),
  Column: container(() => ({ flexDirection: "column" })),
  // Rows: children centred on the cross axis, 8px apart.
  Row: container(
    (p) => ({
      flexDirection: "row",
      alignItems: p.align ? undefined : "center",
      gap: hasGap(p) ? undefined : spacing(2),
    }),
    (p) => ({ "data-a2ui-row": p.justify ?? "start" }),
  ),
  Grid,
  GridItem,
  Card,
  Flow: container((p) => ({
    display: "grid",
    gap: spacing(p.gap ?? 4),
    gridTemplateColumns: gridTemplateColumns({
      columns: p.columns ?? 3,
      gap: p.gap ?? 4,
    }),
    gridAutoFlow: p.layout === "fixed" ? "row" : "dense",
  })),
  FlowItem: container((p) => ({
    ...span(p),
    flexDirection: "column",
    aspectRatio: p.aspectRatio ?? "1 / 1",
  })),
  Carousel,
  CarouselItem: container(() => ({
    flex: "0 0 auto",
    flexDirection: "column",
    scrollSnapAlign: "start",
  })),
  CarouselMediaItem,
  Spacer: ({ props }: RendererProps<any>) => (
    <div
      aria-hidden
      style={{
        flex: 1,
        minWidth: spacing(props.minSize ?? 2),
        minHeight: spacing(props.minSize ?? 2),
      }}
    />
  ),
  Divider: ({ props }: RendererProps<any>) => (
    <hr
      style={{
        border: 0,
        borderTop: `${props.size ?? 1}px solid ${borderColor(props.color ?? "subtle")}`,
        margin: props.flush ? 0 : `${spacing(props.spacing ?? 2)} 0`,
        width: "100%",
        flexShrink: 0,
        alignSelf: "stretch",
      }}
    />
  ),
  Animate: container(),
  AnimateGroup: container(),
  AnimateItem: container(),
  Transition: container(),
} satisfies CatalogRenderers<typeof layoutDefinitions>;
