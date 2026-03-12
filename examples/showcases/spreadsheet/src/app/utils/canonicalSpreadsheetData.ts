import { SpreadsheetRow } from "../types";

export interface RowLike {
    cells: CellLike[] | undefined;
}

export interface CellLike {
    value: string;
}

export function canonicalSpreadsheetData(
    rows: RowLike[] | undefined
): SpreadsheetRow[] {
    const canonicalRows: SpreadsheetRow[] = [];

    for (const row of rows || []) {
        const canonicalRow: SpreadsheetRow = [];
        for (const cell of row.cells || []) {
            canonicalRow.push({value: cell.value});
        }
        canonicalRows.push(canonicalRow);
    }

    return canonicalRows;
}