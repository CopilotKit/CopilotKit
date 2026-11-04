export { buildPdf, toAscii, charBudget, PDF_METRICS } from "./pdf";
export type { Line } from "./pdf";
// `spreadsheet.ts` and `spreadsheet-pdf.ts` are deliberately NOT re-exported
// here. This barrel is imported by server routes (commerce's price-sheet route
// reaches it through `price-sheet-pdf.ts`), and the spreadsheet reader is
// browser-only — it needs `DOMParser` and `DecompressionStream`. Adding it would
// pull DOM-dependent code into a Node route bundle for no caller's benefit. The
// one consumer, `shell/attach/upload-attachment.ts`, deep-imports both.
