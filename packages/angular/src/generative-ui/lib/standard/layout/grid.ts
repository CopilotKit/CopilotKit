import {
  Component,
  ElementRef,
  InjectionToken,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from "@angular/core";
import type { Signal } from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import { spacing } from "@copilotkit/shared/generative-ui";
import type {
  LayoutProps,
  flowItemSchema,
  flowSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { CopilotGenerativeUIChildren } from "../../children.directive";
import { provideContainerContext } from "../context";
import { defined, layoutStyle } from "../style";
import type { StyleMap } from "../style";
import {
  CHILDREN_TEMPLATE,
  CopilotGenerativeUILayoutContainer,
  CopilotGenerativeUILayoutProps,
  hasGap,
} from "./containers";

/** The minimum width at which `columns` cards sit side by side. */
const GRID_MIN_TRACK_PX = 520;

/**
 * The `grid-template-columns` of a Grid. A number of columns becomes an
 * auto-fit template: at most `n` columns, which collapse towards one column
 * when a track gets narrower than 520px / n (260px for two columns).
 */
function gridTemplateColumns(props: {
  columns?: number | string;
  minChildWidth?: number | string;
  gap?: number | string;
  columnGap?: number | string;
}) {
  if (typeof props.columns === "string") return props.columns;
  if (props.minChildWidth !== undefined) {
    return `repeat(auto-fill, minmax(min(100%, ${spacing(props.minChildWidth)}), 1fr))`;
  }
  const count = Math.max(1, Math.floor(props.columns ?? 2));
  if (count === 1) return "minmax(0, 1fr)";
  const gap = spacing(props.columnGap ?? props.gap ?? 4);
  const minTrack = Math.round(Math.max(120, GRID_MIN_TRACK_PX / count));
  return `repeat(auto-fit, minmax(min(100%, max(${minTrack}px, calc((100% - ${count - 1} * ${gap}) / ${count}))), 1fr))`;
}

/**
 * The `grid-column` of a GridItem. A span that covers every rendered column
 * becomes `1 / -1` (the full row), so it never adds implicit tracks that
 * overflow the grid. A smaller span stays `span N`. Without a known column
 * count, the span is used as given.
 */
export function gridItemColumn(
  span: number | undefined,
  columns: number | undefined,
) {
  if (!span) return undefined;
  if (columns !== undefined && span >= columns) return "1 / -1";
  return `span ${span}`;
}

/** The count of resolved tracks of a laid-out grid ("120px 120px" is 2). */
function measureTracks(element: HTMLElement) {
  if (typeof getComputedStyle !== "function") return undefined;
  const tracks = getComputedStyle(element)
    .gridTemplateColumns.split(/\s+/)
    .filter(Boolean);
  // Only a fully resolved template is trusted (browsers report px tracks).
  const isResolved =
    tracks.length > 0 && tracks.every((track) => /^[\d.]+px$/.test(track));
  return isResolved ? tracks.length : undefined;
}

/**
 * The count of columns that the nearest Grid renders now: the measured
 * track count when the browser gives it (auto-fit collapses columns on
 * narrow widths), else the numeric `columns` prop. `undefined` when unknown.
 */
const GENERATIVE_UI_GRID_COLUMNS = new InjectionToken<
  Signal<number | undefined>
>("GENERATIVE_UI_GRID_COLUMNS");

/**
 * A CSS grid. A column count collapses towards one column on narrow
 * widths. The Grid measures the columns it renders, so a GridItem that
 * spans all of them fills the row.
 */
@Component({
  selector: "div[copilotGenerativeUIGrid]",
  imports: [CopilotGenerativeUIChildren],
  template: CHILDREN_TEMPLATE,
  providers: [
    provideContainerContext(),
    {
      provide: GENERATIVE_UI_GRID_COLUMNS,
      useFactory: () => inject(CopilotGenerativeUIGrid).columnsNow,
    },
  ],
})
export class CopilotGenerativeUIGrid extends CopilotGenerativeUILayoutProps {
  readonly columns = input<number | string>();
  readonly minChildWidth = input<number | string>();
  readonly rows = input<number | string>();

  readonly #measured = signal<number | undefined>(undefined);
  /** The columns the browser renders now, else the declared count. */
  readonly columnsNow = computed(
    () => this.#measured() ?? this.#declaredColumns(),
  );

  constructor() {
    super();
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      const update = () => this.#measured.set(measureTracks(element));
      afterNextRender(() => {
        update();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(update);
        observer.observe(element);
        this.#observer = observer;
      });
    }
  }

  #observer: ResizeObserver | undefined;

  ngOnDestroy() {
    this.#observer?.disconnect();
  }

  /** The column count that the props give, or `undefined` when unknown. */
  #declaredColumns() {
    const columns = this.columns();
    if (typeof columns === "number") return Math.max(1, Math.floor(columns));
    const isDefault =
      columns === undefined && this.minChildWidth() === undefined;
    return isDefault ? 2 : undefined;
  }

  protected override computeStyle(props: LayoutProps): StyleMap {
    const rows = this.rows();
    return {
      ...layoutStyle(props),
      ...defined({
        display: "grid",
        gap: hasGap(props) ? undefined : spacing(4),
        gridTemplateColumns: gridTemplateColumns({
          columns: this.columns(),
          minChildWidth: this.minChildWidth(),
          gap: props.gap,
          columnGap: props.columnGap,
        }),
        gridTemplateRows:
          typeof rows === "number" ? `repeat(${rows}, auto)` : rows,
      }),
    };
  }
}

/** A cell of a Grid that spans `span` columns and `rowSpan` rows. */
@Component({
  selector: "div[copilotGenerativeUIGridItem]",
  imports: [CopilotGenerativeUIChildren],
  template: CHILDREN_TEMPLATE,
  providers: [provideContainerContext()],
})
export class CopilotGenerativeUIGridItem extends CopilotGenerativeUILayoutProps {
  readonly span = input<number>();
  readonly rowSpan = input<number>();

  readonly #columns = inject(GENERATIVE_UI_GRID_COLUMNS, {
    optional: true,
    skipSelf: true,
  });

  protected override computeStyle(props: LayoutProps): StyleMap {
    const rowSpan = this.rowSpan();
    return {
      ...layoutStyle(props),
      ...defined({
        gridColumn: gridItemColumn(this.span(), this.#columns?.()),
        gridRow: rowSpan ? `span ${rowSpan}` : undefined,
        flexDirection: "column",
      }),
    };
  }
}

/** A dense grid of tiles, 3 columns by default. */
@Component({
  selector: "div[copilotGenerativeUIFlow]",
  imports: [CopilotGenerativeUIChildren],
  template: CHILDREN_TEMPLATE,
  providers: [provideContainerContext()],
})
export class CopilotGenerativeUIFlow extends CopilotGenerativeUILayoutContainer {
  readonly columns = input<number>();
  readonly rows = input<number>();
  readonly layout = input<z.output<typeof flowSchema>["layout"]>();

  protected override extraStyle(props: LayoutProps): StyleMap {
    return {
      display: "grid",
      gap: spacing(props.gap ?? 4),
      gridTemplateColumns: gridTemplateColumns({
        columns: this.columns() ?? 3,
        gap: props.gap ?? 4,
      }),
      gridAutoFlow: this.layout() === "fixed" ? "row" : "dense",
    };
  }
}

/** A tile of a Flow, square unless it sets `aspectRatio`. */
@Component({
  selector: "div[copilotGenerativeUIFlowItem]",
  imports: [CopilotGenerativeUIChildren],
  template: CHILDREN_TEMPLATE,
  providers: [provideContainerContext()],
})
export class CopilotGenerativeUIFlowItem extends CopilotGenerativeUILayoutContainer {
  readonly span = input<number>();
  readonly rowSpan = input<number>();
  readonly aspectMode = input<z.output<typeof flowItemSchema>["aspectMode"]>();

  protected override extraStyle(props: LayoutProps): StyleMap {
    const span = this.span();
    const rowSpan = this.rowSpan();
    return {
      gridColumn: span ? `span ${span}` : undefined,
      gridRow: rowSpan ? `span ${rowSpan}` : undefined,
      flexDirection: "column",
      aspectRatio: props.aspectRatio ?? "1 / 1",
    };
  }
}
