/**
 * The composer's upload handler — SHELL-OWNED, because every skin's chat panel
 * is the same `CopilotChat` and the spreadsheet problem is a property of the
 * pinned model provider, not of any one domain.
 *
 * Without an `onUpload`, CopilotKit base64-encodes the file and hands it over as
 * a document part. That is exactly right for a PDF or an image and fatal for a
 * spreadsheet: `@ai-sdk/openai@3`'s converter whitelists `image/*` and
 * `application/pdf` and throws `UnsupportedFunctionalityError` on anything else,
 * so an .xlsx does not degrade — it kills the run. (The full picture, including
 * the v4 option that removes the need for any of this, is in
 * `documents/spreadsheet.ts`.)
 *
 * So this handler converts a spreadsheet into a document the pinned converter
 * accepts, and passes everything else through untouched.
 *
 * ── WHAT THE PRESENTER SEES, AND WHY IT IS HONEST ───────────────────────────
 * The attachment keeps its ORIGINAL filename and size in the chip, because that
 * is what the presenter dropped in and what they will call it out loud. What
 * rides to the model is a rendering of that sheet. Those two facts have to be
 * reconcilable if anyone asks, so the conversion is recorded in the part's
 * `metadata` (`convertedFrom`, plus the row count and any truncation) rather
 * than being invisible.
 *
 * Client-only: it reaches for `FileReader`, `DOMParser` and
 * `DecompressionStream`.
 */

import { readFileAsBase64 } from "@copilotkit/shared";
import type { AttachmentUploadResult } from "@copilotkit/shared";
import { buildSpreadsheetPdf } from "@/shell/documents/spreadsheet-pdf";
import {
  readSpreadsheet,
  spreadsheetKind,
  SpreadsheetReadError,
} from "@/shell/documents/spreadsheet";

/**
 * The `accept` filter for the composer.
 *
 * Extensions are listed ALONGSIDE the MIME types deliberately —
 * `matchesAcceptFilter` treats a leading-dot filter as a filename test, which is
 * the only thing that catches a spreadsheet whose `file.type` the browser
 * reports as empty or as the legacy `application/vnd.ms-excel`. Keep this in
 * step with `spreadsheetKind`, or a file the reader could handle is rejected
 * before it ever reaches this module.
 */
export const COMPOSER_ACCEPT = [
  "application/pdf",
  "image/*",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  ".xlsx",
  ".xlsm",
  ".xls",
  ".csv",
  ".tsv",
].join(",");

/** 20MB, matching the framework default this app used before it set one. */
export const COMPOSER_MAX_SIZE = 20 * 1024 * 1024;

/** Base64 for arbitrary bytes, chunked so a large sheet cannot blow the stack. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Convert a spreadsheet to an attachable document, or pass the file through.
 *
 * A spreadsheet that cannot be READ throws, which is the point: `processFiles`
 * catches an `onUpload` rejection and reports it through `onUploadFailed`, so
 * the presenter is told the sheet was unreadable instead of the file quietly
 * riding along as bytes the model then invents contents for.
 */
export async function uploadAttachment(
  file: File,
): Promise<AttachmentUploadResult> {
  const kind = spreadsheetKind(file);
  if (kind === null) {
    return {
      type: "data",
      value: await readFileAsBase64(file),
      mimeType: file.type,
    };
  }

  try {
    const sheets = await readSpreadsheet(file);
    const document = buildSpreadsheetPdf(file.name, sheets);
    // CANONICAL, not `file.type`. The browser reports no type at all for a
    // spreadsheet dragged out of some tools, and the legacy `application/vnd.ms-excel`
    // for others. This value is what the transcript's badge is derived from
    // (see `shell/chat/converted-attachment-message.tsx`), and an empty string
    // there renders "FILE" beside an .xlsx — the exact wrong-label problem the
    // renderer exists to fix.
    const originalMimeType =
      kind === "csv"
        ? "text/csv"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    return {
      type: "data",
      value: toBase64(document.bytes),
      // DELIBERATELY the spreadsheet's type, not the PDF the bytes are. Every
      // surface a human sees derives its badge from this field, and neither the
      // composer queue nor the transcript is slot-overridable — so the part
      // carries the honest-to-the-user type here, and
      // `rewriteSpreadsheetParts` swaps it to application/pdf server-side
      // before the model ever sees it. See `spreadsheet-wire-format.ts`.
      mimeType: originalMimeType,
      // EVERY VALUE IS A STRING, deliberately. The part's metadata is what the
      // restored transcript reads its filename back out of
      // (`CopilotChatUserMessage.getFilename`), and a metadata object carrying a
      // number or an array does not survive the thread round-trip — the whole
      // object comes back absent, so the rehydrated chip falls back to printing
      // "application/pdf" where it had shown the spreadsheet's name. The plain
      // PDF path is immune only because it adds no metadata of its own beyond
      // the framework's string `filename`.
      metadata: {
        convertedFrom: originalMimeType,
        originalFilename: file.name,
        sheetNames: sheets.map((sheet) => sheet.name).join(", "),
        rows: String(document.totalRows),
        ...(document.truncatedCells > 0
          ? { truncatedCells: String(document.truncatedCells) }
          : {}),
      },
    };
  } catch (error) {
    const reason =
      error instanceof SpreadsheetReadError
        ? error.message
        : `it could not be parsed (${error instanceof Error ? error.message : String(error)})`;
    throw new Error(`${file.name} could not be attached: ${reason}`, {
      cause: error,
    });
  }
}

/** What a presenter can actually drop in, in words rather than in MIME types. */
const SUPPORTED_IN_WORDS =
  "PDFs, images, and spreadsheets (.xlsx, .xls, .csv, .tsv)";

/**
 * Report a rejected upload to the presenter.
 *
 * `window.alert` for the same reason the beat-3d chain uses it: this fires while
 * someone is standing in front of an audience, nobody opens devtools mid-demo,
 * and the alternative — the framework's default of dropping the file with no
 * trace at all — is what made an unsupported .xlsx look like a dead click.
 *
 * The `invalid-type` message is REWRITTEN rather than passed through. The
 * framework's own text appends the raw `accept` string, which is now ten
 * comma-separated MIME types and extensions — projected at an audience that is
 * a wall of noise, and it buries the one thing the presenter needs, which is
 * which file to reach for instead. Every other reason keeps its own message,
 * because those are specific and already readable.
 */
export function reportUploadFailure(error: {
  reason: string;
  file?: { name?: string };
  message: string;
}): void {
  const message =
    error.reason === "invalid-type"
      ? `${error.file?.name ?? "That file"} cannot be attached. Supported: ${SUPPORTED_IN_WORDS}.`
      : error.message;
  console.error(`[attach:${error.reason}] ${error.message}`);
  if (typeof window !== "undefined") window.alert(message);
}
