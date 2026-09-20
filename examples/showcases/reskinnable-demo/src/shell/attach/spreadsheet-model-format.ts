/**
 * The seam that lets a spreadsheet attachment LOOK like a spreadsheet everywhere
 * a human sees it, while reaching the model as something it can actually read.
 *
 * ── THE TWO REQUIREMENTS ────────────────────────────────────────────────────
 * The client converts a dropped .xlsx into a PDF, because the pinned
 * `@ai-sdk/openai@3` converter accepts no document media type but
 * `application/pdf` (see `shell/documents/spreadsheet.ts`). So the bytes must be
 * a PDF by the time a model sees them.
 *
 * But every chip a human looks at derives its badge from the part's `mimeType`
 * via `getDocumentIcon`: the composer's attachment queue and the transcript both
 * do, and NEITHER is slot-overridable (the queue is hard-wired inside
 * `CopilotChatView`). Declare the part `application/pdf` and a file called
 * `q2-expenses.xlsx` sits behind a bold PDF badge, on screen, at the exact
 * moment the demo says "we can drop a spreadsheet in here".
 *
 * ── WHY THE SWAP HAPPENS HERE AND NOT EARLIER ───────────────────────────────
 * The obvious place is the API route, rewriting the request body on its way in.
 * That was tried and is WRONG: the runtime persists and echoes back the body it
 * receives, so rewriting there makes the transcript and every later reload show
 * the PDF type too — fixing the composer by breaking everything after it.
 *
 * Wrapping the AGENT is the seam that separates the two. The runtime has already
 * taken its copy for persistence and for the echoed message snapshot by the time
 * `run` is called, so rewriting the input HERE reaches only the model. The part
 * keeps its spreadsheet type in the UI and in the thread; only the model leg
 * sees `application/pdf`.
 *
 * Applied to every registered agent in `buildAgents`, so it is a property of the
 * app rather than of whichever skin happens to accept spreadsheets.
 *
 * ── WHAT WOULD MAKE THIS UNNECESSARY ────────────────────────────────────────
 * `@ai-sdk/openai@4`'s `passThroughUnsupportedFiles`, which sends the .xlsx to
 * the Responses API untouched and lets OpenAI do its own spreadsheet parsing.
 * Then the client stops converting and the media type is simply true end to end.
 *
 * Server-safe: plain TS, no React, no DOM.
 */

/** Media types this app converts to PDF on the client before sending. */
const CONVERTED_MEDIA_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "text/csv",
  "text/tab-separated-values",
]);

interface DocumentPartLike {
  type?: unknown;
  source?: { type?: unknown; mimeType?: unknown; value?: unknown };
  metadata?: Record<string, unknown>;
}

/**
 * A per-run bridge: rewrite spreadsheet parts to PDF on the way IN to the
 * agent, and rewrite them back on the way OUT.
 *
 * ── WHY BOTH DIRECTIONS ─────────────────────────────────────────────────────
 * Rewriting the input alone is not enough. The agent echoes a messages snapshot
 * back down the event stream, and that snapshot carries whatever media type it
 * was handed — so the PDF type flows straight into the transcript and into the
 * persisted thread, and the chip reads "PDF" for good. Measured: the thread's
 * events end up holding both types, and the UI picks the wrong one.
 *
 * So the outbound half restores the spreadsheet type on the way back, and only
 * the model leg ever sees `application/pdf`.
 *
 * ── HOW A CONVERTED PART IS RECOGNISED ON THE WAY BACK ──────────────────────
 * By its exact base64 payload, recorded when it was rewritten. There is no
 * marker left to key on otherwise: the part carries `metadata` on the way in but
 * the platform's canonical history drops it, and the media type by then is a
 * bare `application/pdf` indistinguishable from a genuine PDF attachment. Keying
 * on the payload is what keeps a real invoice PDF — which this demo also
 * uploads — from being mislabelled as a spreadsheet.
 */
export interface SpreadsheetBridge {
  /** Rewrite spreadsheet parts to `application/pdf` for the model. */
  toModel: <T>(input: T) => T;
  /** Restore the original media type on anything coming back. */
  fromModel: <T>(event: T) => T;
}

export function createSpreadsheetBridge(): SpreadsheetBridge {
  /**
   * base64 payload → everything the agent echo throws away.
   *
   * The media type is the obvious one. `metadata` is here for the same reason:
   * the echoed snapshot drops it wholesale, and it carries the FILENAME the chip
   * prints — without it the chip falls back to rendering the raw media type, so
   * a restored spreadsheet reads as a wall of `application/vnd.openxml…` instead
   * of `sample-q2-expenses.xlsx`.
   */
  const converted = new Map<
    string,
    { mimeType: string; metadata?: Record<string, unknown> }
  >();

  const mapParts = (
    value: unknown,
    rewrite: (part: DocumentPartLike) => DocumentPartLike | null,
  ): unknown => {
    const messages = (value as { messages?: unknown })?.messages;
    if (!Array.isArray(messages)) return value;

    let anyChanged = false;
    const nextMessages = messages.map((message) => {
      const content = (message as { content?: unknown })?.content;
      if (!Array.isArray(content)) return message;

      let changed = false;
      const nextContent = content.map((part) => {
        const doc = part as DocumentPartLike;
        if (doc?.type !== "document" || !doc.source) return part;
        const next = rewrite(doc);
        if (!next) return part;
        changed = true;
        return next;
      });

      if (!changed) return message;
      anyChanged = true;
      return { ...(message as object), content: nextContent };
    });

    return anyChanged
      ? { ...(value as object), messages: nextMessages }
      : value;
  };

  return {
    toModel: <T>(input: T): T =>
      mapParts(input, (doc) => {
        const mimeType = doc.source?.mimeType;
        const payload = doc.source?.value;
        if (
          typeof mimeType !== "string" ||
          !CONVERTED_MEDIA_TYPES.has(mimeType) ||
          typeof payload !== "string"
        ) {
          return null;
        }
        converted.set(payload, { mimeType, metadata: doc.metadata });
        return {
          ...doc,
          source: { ...doc.source, mimeType: "application/pdf" },
        };
      }) as T,

    fromModel: <T>(event: T): T =>
      mapParts(event, (doc) => {
        const payload = doc.source?.value;
        if (
          doc.source?.mimeType !== "application/pdf" ||
          typeof payload !== "string"
        ) {
          return null;
        }
        const original = converted.get(payload);
        if (!original) return null;
        return {
          ...doc,
          source: { ...doc.source, mimeType: original.mimeType },
          ...(original.metadata ? { metadata: original.metadata } : {}),
        };
      }) as T,
  };
}
