import {
  Component,
  InjectionToken,
  computed,
  forwardRef,
  inject,
  input,
} from "@angular/core";
import type { Injector, Signal } from "@angular/core";
import {
  FONT_WEIGHT,
  backgroundColor,
  isRecord,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type {
  TableColumn,
  tableCellSchema,
  tableSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import type { GenerativeUIChildren } from "../../children";
import { CopilotGenerativeUIChildren } from "../../children.directive";
import { injectGenerativeUIAccessibility } from "../../node-context";
import { GenerativeUIStyles } from "../../styles";
import { VISUALLY_HIDDEN } from "../style";
import type { StyleMap } from "../style";

/**
 * What a Table, TableSection or TableRow tells the rows and cells in it.
 * Each provides itself.
 */
export interface GenerativeUITableContext {
  rowDividers: Signal<boolean>;
  /** True inside a TableSection or a TableRow. */
  inSection: Signal<boolean>;
  /** True inside a header section or row. Cells there are header cells. */
  headerRows: Signal<boolean>;
}

export const GENERATIVE_UI_TABLE_CONTEXT =
  new InjectionToken<GenerativeUITableContext>("GENERATIVE_UI_TABLE_CONTEXT");

type TableProps = z.output<typeof tableSchema>;
type TableCellProps = z.output<typeof tableCellSchema>;
type NormalizedColumn = Partial<Extract<TableColumn, { label: string }>>;

const V_ALIGN = { start: "top", center: "middle", end: "bottom" } as const;

/**
 * The style of a cell: 14px text, 8px padding (none at the outer edges),
 * medium weight for headers, hairline row dividers. The padding, edges and
 * dividers come from the `.a2ui-std-cell` rules, so a `padding` prop still
 * wins.
 */
function cellStyle(
  options: { isHeader: boolean } & Pick<
    TableCellProps,
    "align" | "vAlign" | "width" | "padding"
  >,
): StyleMap {
  return {
    ...textFont("sm"),
    textAlign: options.align ?? "start",
    verticalAlign: V_ALIGN[options.vAlign ?? "start"],
    padding: spacing(options.padding),
    width: spacing(options.width),
    fontWeight: options.isHeader ? FONT_WEIGHT.medium : undefined,
    color: textColor("default"),
  };
}

/** The component id of a `{ componentId }` or `{ id }` cell, else `undefined`. */
function cellComponentId(value: unknown) {
  if (!isRecord(value)) return undefined;
  if ("componentId" in value && typeof value.componentId === "string") {
    return value.componentId || undefined;
  }
  if ("id" in value && typeof value.id === "string") {
    return value.id || undefined;
  }
  return undefined;
}

function cellText(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function normalizeColumn(column: TableColumn): NormalizedColumn {
  if (typeof column === "string") return { label: column };
  const componentId = cellComponentId(column);
  return "label" in column ? { ...column, componentId } : { componentId };
}

/**
 * A data table from `columns` and `rows`, or from TableSection and TableRow
 * children. The host is the scroll wrapper around the `<table>`.
 */
@Component({
  selector: "div[copilotGenerativeUITable]",
  imports: [CopilotGenerativeUIChildren],
  providers: [
    {
      provide: GENERATIVE_UI_TABLE_CONTEXT,
      useExisting: forwardRef(() => CopilotGenerativeUITable),
    },
  ],
  template: `
    <table class="a2ui-std-table" [style]="tableStyle()">
      @if (caption(); as caption) {
        <caption [style]="visuallyHidden">
          {{
            caption
          }}
        </caption>
      }
      @if (isChildrenMode()) {
        <ng-container *copilotGenerativeUIChildren="children()" />
      } @else {
        @if (normalizedColumns().length > 0) {
          <thead>
            <tr>
              @for (column of normalizedColumns(); track $index) {
                <th
                  scope="col"
                  class="a2ui-std-cell"
                  data-divider
                  [style]="headerCellStyle(column)"
                >
                  {{ column.label }}
                  @if (column.componentId; as id) {
                    <ng-container *copilotGenerativeUIChildren="cellHandle(id)" />
                  }
                </th>
              }
            </tr>
          </thead>
        }
        <tbody>
          @if (rowList().length === 0) {
            <tr>
              <td
                [attr.colspan]="columnCount()"
                class="a2ui-std-cell"
                [style]="emptyStyle"
              >
                {{ emptyLabel() ?? "No rows" }}
              </td>
            </tr>
          } @else {
            @for (row of rowList(); track $index; let rowIndex = $index) {
              <tr>
                @for (value of row; track $index; let columnIndex = $index) {
                  <td
                    class="a2ui-std-cell"
                    [attr.data-divider]="hasDivider(rowIndex) ? '' : null"
                    [style]="bodyCellStyle(columnIndex)"
                  >
                    @if (cellId(value); as id) {
                      <ng-container *copilotGenerativeUIChildren="cellHandle(id)" />
                    } @else {
                      {{ cellText(value) }}
                    }
                  </td>
                }
              </tr>
            }
          }
        </tbody>
      }
    </table>
  `,
  host: {
    class: "a2ui-std-table-wrap",
    "data-a2ui-std": "",
    "[style]": "wrapperStyle()",
  },
})
export class CopilotGenerativeUITable implements GenerativeUITableContext {
  readonly caption = input<string>();
  readonly columns = input<TableProps["columns"]>();
  readonly rows = input<TableProps["rows"]>();
  readonly columnSizing = input<TableProps["columnSizing"]>();
  readonly dividers = input<boolean>();
  readonly stickyHeader = input<boolean>();
  readonly emptyLabel = input<string>();
  readonly children = input<GenerativeUIChildren>();
  readonly cellComponents = input<GenerativeUIChildren>();

  readonly rowDividers = computed(() => this.dividers() ?? true);
  readonly inSection = computed(() => false);
  readonly headerRows = computed(() => false);

  protected readonly visuallyHidden = VISUALLY_HIDDEN;
  protected readonly emptyStyle: StyleMap = {
    ...cellStyle({ isHeader: false }),
    color: textColor("tertiary"),
    textAlign: "center",
  };
  protected readonly normalizedColumns = computed(() =>
    (this.columns() ?? []).map(normalizeColumn),
  );
  protected readonly rowList = computed(() => this.rows() ?? []);
  protected readonly isChildrenMode = computed(
    () =>
      this.children() !== undefined &&
      this.rowList().length === 0 &&
      this.normalizedColumns().length === 0,
  );
  protected readonly columnCount = computed(() =>
    Math.max(
      this.normalizedColumns().length,
      ...this.rowList().map((row) => row.length),
      1,
    ),
  );
  protected readonly tableStyle = computed<StyleMap>(() => ({
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: this.columnSizing() === "equal" ? "fixed" : "auto",
  }));
  protected readonly wrapperStyle = computed<StyleMap>(() => ({
    maxHeight: this.stickyHeader() ? "480px" : undefined,
    overflowY: this.stickyHeader() ? "auto" : undefined,
  }));
  /** One handle for each `{ componentId }` cell, from the `cellComponents` slot. */
  readonly #cellHandles = computed(() => {
    const slot = this.cellComponents();
    const handles = new Map<string, GenerativeUIChildren>();
    if (!slot || typeof slot.value === "string" || !Array.isArray(slot.value)) {
      return handles;
    }
    for (const id of slot.value) {
      handles.set(id, { ...slot, value: id });
    }
    return handles;
  });

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
  }

  protected cellHandle(id: string) {
    return this.#cellHandles().get(id);
  }

  protected cellId(value: unknown) {
    return cellComponentId(value);
  }

  protected cellText(value: unknown) {
    return cellText(value);
  }

  protected hasDivider(rowIndex: number) {
    return this.rowDividers() && rowIndex < this.rowList().length - 1;
  }

  protected headerCellStyle(column: NormalizedColumn): StyleMap {
    const sticky: StyleMap = this.stickyHeader()
      ? { position: "sticky", top: 0, background: backgroundColor("surface") }
      : {};
    return {
      ...cellStyle({
        isHeader: true,
        align: column.align,
        width: column.width,
      }),
      ...sticky,
    };
  }

  protected bodyCellStyle(columnIndex: number): StyleMap {
    return cellStyle({
      isHeader: false,
      align: this.normalizedColumns()[columnIndex]?.align,
    });
  }
}

/**
 * A group of TableRow children. The host is a `<tbody>` also for a header
 * section: a host element cannot change its tag. The cells of a header
 * section are column headers, which is what names the columns.
 */
@Component({
  selector: "tbody[copilotGenerativeUITableSection]",
  imports: [CopilotGenerativeUIChildren],
  providers: [
    {
      provide: GENERATIVE_UI_TABLE_CONTEXT,
      useExisting: forwardRef(() => CopilotGenerativeUITableSection),
    },
  ],
  template: `
    <ng-container *copilotGenerativeUIChildren="children()" />
  `,
  host: {
    "[attr.aria-label]": "aria()['aria-label'] ?? null",
    "[attr.aria-description]": "aria()['aria-description'] ?? null",
    "[attr.aria-hidden]": "aria()['aria-hidden'] ? 'true' : null",
    "[attr.aria-live]": "aria()['aria-live'] ?? null",
    "[attr.data-a2ui-header]": "header() ? '' : null",
  },
})
export class CopilotGenerativeUITableSection implements GenerativeUITableContext {
  readonly header = input<boolean>();
  readonly rowDivider = input<boolean>();
  readonly children = input<GenerativeUIChildren>();

  readonly #parent = inject(GENERATIVE_UI_TABLE_CONTEXT, {
    skipSelf: true,
    optional: true,
  });
  protected readonly aria = injectGenerativeUIAccessibility();

  readonly rowDividers = computed(
    () => this.rowDivider() ?? this.#parent?.rowDividers() ?? true,
  );
  readonly inSection = computed(() => true);
  readonly headerRows = computed(() => this.header() === true);
}

/**
 * A row of a Table. The host is the `<tr>`. A row directly in a Table has
 * no row group of its own: the browser gives it an anonymous one.
 */
@Component({
  selector: "tr[copilotGenerativeUITableRow]",
  imports: [CopilotGenerativeUIChildren],
  providers: [
    {
      provide: GENERATIVE_UI_TABLE_CONTEXT,
      useExisting: forwardRef(() => CopilotGenerativeUITableRow),
    },
  ],
  template: `
    @if (label(); as label) {
      <th
        scope="row"
        [attr.colspan]="labelColSpan() ?? null"
        class="a2ui-std-cell"
        [attr.data-divider]="rowDividers() ? '' : null"
        [style]="labelStyle"
      >
        {{ label }}
      </th>
    }
    <ng-container *copilotGenerativeUIChildren="children()" />
  `,
  host: {
    "[attr.aria-label]": "aria()['aria-label'] ?? null",
    "[attr.aria-description]": "aria()['aria-description'] ?? null",
    "[attr.aria-hidden]": "aria()['aria-hidden'] ? 'true' : null",
    "[attr.aria-live]": "aria()['aria-live'] ?? null",
  },
})
export class CopilotGenerativeUITableRow implements GenerativeUITableContext {
  readonly header = input<boolean>();
  readonly label = input<string>();
  readonly labelColSpan = input<number>();
  readonly children = input<GenerativeUIChildren>();

  readonly #parent = inject(GENERATIVE_UI_TABLE_CONTEXT, {
    skipSelf: true,
    optional: true,
  });
  protected readonly aria = injectGenerativeUIAccessibility();
  protected readonly labelStyle = cellStyle({ isHeader: true, align: "start" });

  readonly rowDividers = computed(() => this.#parent?.rowDividers() ?? true);
  readonly inSection = computed(() => true);
  readonly headerRows = computed(
    () => this.header() === true || this.#parent?.headerRows() === true,
  );
}

/**
 * A cell of a TableRow: a `<th>` in a header row or with `header`, else a
 * `<td>`. The node renderer creates the host from `hostTag`.
 * It applies the envelope itself: no element sits between the row and it.
 */
@Component({
  selector: "[copilotGenerativeUITableCell]",
  imports: [CopilotGenerativeUIChildren],
  template: `
    @if (text() !== undefined) {
      {{ cellText(text()) }}
    }
    <ng-container *copilotGenerativeUIChildren="children()" />
  `,
  host: {
    class: "a2ui-std-cell",
    "[attr.scope]": "scope()",
    "[attr.colspan]": "colSpan() ?? null",
    "[attr.rowspan]": "rowSpan() ?? null",
    "[attr.data-divider]": "hasDivider() ? '' : null",
    "[attr.aria-label]": "aria()['aria-label'] ?? null",
    "[attr.aria-description]": "aria()['aria-description'] ?? null",
    "[attr.aria-hidden]": "aria()['aria-hidden'] ? 'true' : null",
    "[attr.aria-live]": "aria()['aria-live'] ?? null",
    "[style]": "style()",
  },
})
export class CopilotGenerativeUITableCell {
  /** A header cell is a `<th>`. */
  static hostTag(props: Record<string, unknown>, injector: Injector) {
    const parent = injector.get(GENERATIVE_UI_TABLE_CONTEXT, null);
    return props.header === true || parent?.headerRows() === true ? "th" : "td";
  }

  readonly text = input<string | number>();
  readonly header = input<boolean>();
  readonly align = input<TableCellProps["align"]>();
  readonly vAlign = input<TableCellProps["vAlign"]>();
  readonly colSpan = input<number>();
  readonly rowSpan = input<number>();
  readonly width = input<TableCellProps["width"]>();
  readonly padding = input<TableCellProps["padding"]>();
  readonly children = input<GenerativeUIChildren>();

  readonly #parent = inject(GENERATIVE_UI_TABLE_CONTEXT, { optional: true });
  protected readonly aria = injectGenerativeUIAccessibility();

  protected readonly isHeader = computed(
    () => this.header() === true || this.#parent?.headerRows() === true,
  );
  /** A header cell in a header row names a column. Else it names its row. */
  protected readonly scope = computed(() => {
    if (!this.isHeader()) return null;
    return this.#parent?.headerRows() ? "col" : "row";
  });
  protected readonly hasDivider = computed(
    () => this.#parent?.rowDividers() ?? true,
  );
  protected readonly style = computed(() =>
    cellStyle({
      isHeader: this.isHeader(),
      align: this.align(),
      vAlign: this.vAlign(),
      width: this.width(),
      padding: this.padding(),
    }),
  );

  protected cellText(value: unknown) {
    return cellText(value);
  }
}
