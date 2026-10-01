import type { KeyboardEvent, ReactNode } from 'react';

import styles from './data-display.module.css';

export interface DataTableColumn<Row extends Record<string, unknown>> {
  readonly id: string;
  readonly header: ReactNode;
  /**
   * Text label for the responsive/stacked (card) view, surfaced on each cell as
   * `data-label`. Defaults to `header` when it is a plain string; supply this
   * explicitly for columns whose header is a rich `ReactNode`, otherwise the
   * stacked cell renders without a label.
   */
  readonly label?: string;
  readonly accessor?: keyof Row;
  readonly cell?: (row: Row) => ReactNode;
  readonly align?: 'start' | 'center' | 'end';
}

export interface DataTableProps<Row extends Record<string, unknown>> {
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly caption?: ReactNode;
  readonly captionHidden?: boolean;
  readonly ariaLabel?: string;
  readonly emptyMessage?: ReactNode;
  readonly rowKey?: (row: Row, index: number) => string;
  readonly rowClassName?: (row: Row, index: number) => string | undefined;
  readonly onRowClick?: (row: Row, index: number) => void;
}

/** Resolves the CSS class for a table cell alignment. */
function getAlignmentClass(
  align: DataTableColumn<Record<string, unknown>>['align'],
): string {
  if (align === 'center') {
    return styles.alignCenter;
  }

  if (align === 'end') {
    return styles.alignEnd;
  }

  return styles.alignStart;
}

/** Renders the display value for a table cell from a column definition. */
function renderCell<Row extends Record<string, unknown>>(
  row: Row,
  column: DataTableColumn<Row>,
): ReactNode {
  if (column.cell !== undefined) {
    return column.cell(row);
  }

  if (column.accessor === undefined) {
    return null;
  }

  const value = row[column.accessor];
  return value === null || value === undefined ? null : String(value);
}

/**
 * Activate a clickable data row from keyboard input.
 *
 * @param event - Keyboard event from the row.
 * @param row - The backing row data.
 * @param rowIndex - The row position.
 * @param onRowClick - Optional row activation callback.
 */
function handleRowKeyDown<Row extends Record<string, unknown>>(
  event: KeyboardEvent<HTMLTableRowElement>,
  row: Row,
  rowIndex: number,
  onRowClick: ((row: Row, index: number) => void) | undefined,
): void {
  if (onRowClick === undefined) {
    return;
  }

  if (event.target !== event.currentTarget) {
    return;
  }

  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  event.preventDefault();
  onRowClick(row, rowIndex);
}

/** Renders a semantic responsive table for compact product data. */
export function DataTable<Row extends Record<string, unknown>>({
  columns,
  rows,
  caption,
  captionHidden = false,
  ariaLabel,
  emptyMessage = 'No data available',
  rowKey,
  rowClassName,
  onRowClick,
}: DataTableProps<Row>): ReactNode {
  const tableLabel =
    caption === undefined && ariaLabel !== undefined ? ariaLabel : undefined;

  return (
    <div className={styles.tableViewport}>
      <table className={styles.table} aria-label={tableLabel}>
        {caption !== undefined ? (
          <caption
            className={captionHidden ? styles.visuallyHidden : styles.caption}
          >
            {caption}
          </caption>
        ) : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                className={`${styles.headCell} ${getAlignmentClass(column.align)}`}
                key={column.id}
                scope="col"
              >
                <span className={styles.cellContent}>{column.header}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className={styles.emptyCell} colSpan={columns.length}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr
                className={[styles.row, rowClassName?.(row, rowIndex)]
                  .filter(Boolean)
                  .join(' ')}
                key={rowKey?.(row, rowIndex) ?? String(rowIndex)}
                onClick={
                  onRowClick === undefined
                    ? undefined
                    : () => {
                        onRowClick(row, rowIndex);
                      }
                }
                onKeyDown={(event) => {
                  handleRowKeyDown(event, row, rowIndex, onRowClick);
                }}
                tabIndex={onRowClick === undefined ? undefined : 0}
              >
                {columns.map((column) => (
                  <td
                    className={`${styles.cell} ${getAlignmentClass(column.align)}`}
                    data-label={
                      column.label ??
                      (typeof column.header === 'string'
                        ? column.header
                        : undefined)
                    }
                    key={column.id}
                  >
                    <span className={styles.cellContent}>
                      {renderCell(row, column)}
                    </span>
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
