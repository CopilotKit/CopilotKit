/**
 * Receipt image-attachment flow for the Personal Finance Copilot.
 *
 * Capture → parse → draft. When the user attaches a receipt photo in chat, the
 * image is POSTed to the runtime's vision endpoint (`/api/receipt`), which
 * returns a structured {@link ReceiptDraft}. The draft is held in module state
 * and surfaced to the agent through a `parseReceipt` frontend tool.
 *
 * DECOUPLING: this file does NOT know about (or import) the `addTransaction`
 * tool. It only produces a `ReceiptDraft`. The agent orchestrates the chain —
 * after `parseReceipt` returns the draft, the agent naturally calls the
 * separately-registered `addTransaction` tool with those fields. Our job ends
 * at "here is the parsed receipt."
 *
 * ─────────────────────────────────────────────────────────────────────────
 * useAttachments — headless vs native (verdict)
 * ─────────────────────────────────────────────────────────────────────────
 * `useAttachments` (from `@copilotkit/react-native`) statically imports
 * `expo-document-picker` and `expo-file-system`. BOTH are stubbed to empty
 * modules in this app's `metro.config.js` (the headless provider doesn't need
 * Expo). Consequences for the two code paths the hook exposes:
 *
 *   • `openPicker()`     → calls `DocumentPicker.getDocumentAsync()`. STUBBED,
 *                          so it throws (caught & logged internally) and is a
 *                          no-op here. Unusable without un-stubbing Expo.
 *   • `processFiles(f)`  → USABLE headless, *provided we supply `onUpload`*.
 *                          Without `onUpload`, the hook falls back to
 *                          `FileSystem.readAsStringAsync()` for base64 — also
 *                          stubbed, so it would throw. We therefore ALWAYS
 *                          pass a custom `onUpload` that base64-encodes +
 *                          parses the receipt ourselves, never touching the
 *                          stubbed `expo-file-system`.
 *
 * So the attachment STATE machine + `onUpload` pipeline run fine on
 * RN 0.85 / Hermes with zero native modules. The ONE thing that genuinely
 * needs native code is obtaining the image in the first place — i.e. a
 * `file://` URI from the camera or photo library. We accept that image via
 * {@link useReceiptCapture}().captureReceiptFile(file) (a `NativeFileInput`)
 * and base64-encode it in `onUpload` via a fetch→blob→base64 path that works
 * on Hermes. See CONCERNS in the agent report for the exact native wiring the
 * integration must add to source that URI (image picker / camera).
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { z } from "zod";
import { useAttachments, useFrontendTool } from "@copilotkit/react-native";
import type { NativeFileInput } from "@copilotkit/react-native";
import { TOOLS } from "./contracts";
import type { ReceiptDraft } from "./contracts";
import { parseReceiptImage } from "./receiptClient";
import { ReceiptPreviewCard } from "./ResultCards";

export {
  RECEIPT_ENDPOINT,
  RECEIPT_PATH,
  DEFAULT_RUNTIME_BASE,
  configureReceiptEndpoint,
  getReceiptEndpoint,
} from "./receiptClient";

/** Status of the most-recent capture/parse cycle, for optional UI. */
export type ReceiptCaptureStatus = "idle" | "parsing" | "ready" | "error";

export interface ReceiptCaptureState {
  status: ReceiptCaptureStatus;
  /** The most recently parsed draft (the agent reads this via `parseReceipt`). */
  draft: ReceiptDraft | null;
  /** Human-readable error from the last failed parse, if any. */
  error: string | null;
}

export interface ReceiptCaptureApi extends ReceiptCaptureState {
  /**
   * Feed a picked/captured image into the flow. `file.uri` must be a readable
   * local URI (e.g. `file:///…/receipt.jpg`) produced by a native image source
   * (camera/library). Runs validation + base64 encode + parse via the hook's
   * `processFiles`/`onUpload` pipeline and stores the resulting draft.
   */
  captureReceiptFile: (file: NativeFileInput) => Promise<void>;
  /** The most recent draft, or null. Stable accessor for non-React callers. */
  getDraft: () => ReceiptDraft | null;
  /** Clear the current draft/error back to idle. */
  reset: () => void;
}

const ReceiptCaptureContext = createContext<ReceiptCaptureApi | null>(null);

/**
 * Access the receipt capture API from anywhere under `<ReceiptTools>`.
 * Use `captureReceiptFile(file)` to hand a picked image into the flow, and
 * read `draft`/`status` for optional UI.
 */
export function useReceiptCapture(): ReceiptCaptureApi {
  const ctx = useContext(ReceiptCaptureContext);
  if (!ctx) {
    throw new Error(
      "useReceiptCapture must be used within <ReceiptTools> (mount it under CopilotKitProvider).",
    );
  }
  return ctx;
}

/**
 * Read a local file URI as a base64 string WITHOUT expo-file-system.
 *
 * RN's `fetch` can read a `file://` (and `content://`/`ph://` on the
 * respective platforms) URI into a Blob. We then use FileReader (provided by
 * the CopilotKit RN polyfills, which patch the global DOM-ish APIs) to get a
 * data URL and strip the prefix. This keeps the whole path Hermes-friendly and
 * free of the stubbed `expo-file-system` module.
 */
async function readUriAsBase64(uri: string): Promise<string> {
  const res = await fetch(uri);
  const blob = await res.blob();
  const dataUrl: string = await new Promise((resolve, reject) => {
    // FileReader is polyfilled by @copilotkit/react-native's auto-imported
    // polyfills. Guard so a clear error surfaces if it is ever absent.
    const Reader = (globalThis as { FileReader?: typeof FileReader })
      .FileReader;
    if (!Reader) {
      reject(
        new Error("FileReader is unavailable; cannot encode receipt image."),
      );
      return;
    }
    const reader = new Reader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read receipt image."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob as Blob);
  });
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** Schema for the `parseReceipt` frontend tool — it takes no input. */
const parseReceiptParameters = z.object({});

export interface ReceiptToolsProps {
  /**
   * Restrict the tool to a single agent. Omit to expose it to all agents.
   * Forwarded to `useFrontendTool`.
   */
  agentId?: string;
  /**
   * Max accepted image size in bytes (forwarded to the attachments config).
   * Defaults to 10MB to match the runtime's `MAX_IMAGE_BYTES`.
   */
  maxSize?: number;
  /** Optional children (e.g. a capture button) rendered with capture context. */
  children?: ReactNode;
}

/**
 * `<ReceiptTools/>` — mount once under `<CopilotKitProvider>`.
 *
 * Wires three things together:
 *   1. `useAttachments` with a custom `onUpload` (headless-safe, no Expo) that
 *      base64-encodes the image, POSTs it to `/api/receipt`, and stashes the
 *      returned {@link ReceiptDraft}.
 *   2. A `parseReceipt` frontend tool (name from `TOOLS.parseReceipt`) that the
 *      agent calls to obtain the latest draft. Returning the draft lets the
 *      agent then call the separately-registered `addTransaction` tool.
 *   3. A React context so app UI can push picked images in
 *      (`useReceiptCapture().captureReceiptFile`) and render status.
 */
export function ReceiptTools({
  agentId,
  maxSize = 10 * 1024 * 1024,
  children,
}: ReceiptToolsProps): React.ReactElement {
  const [state, setState] = useState<ReceiptCaptureState>({
    status: "idle",
    draft: null,
    error: null,
  });

  // Stable mirror so the frontend-tool handler and `getDraft` read fresh data
  // without being re-created on every parse (keeps the tool registration stable).
  const draftRef = useRef<ReceiptDraft | null>(null);

  // Track an in-flight parse so its result can be awaited by the tool handler
  // even if the agent calls `parseReceipt` slightly before the upload settles.
  const pendingRef = useRef<Promise<ReceiptDraft> | null>(null);

  // Local URI of the last captured receipt image, so the in-chat preview card
  // can show a thumbnail. Stays null when no receipt has been captured yet.
  const lastImageUriRef = useRef<string | null>(null);

  /**
   * Custom upload handler. Receiving this means the hook NEVER calls the
   * stubbed `expo-file-system`. We return an `AttachmentUploadResult` (a data
   * source) so the attachment still resolves to "ready" inside the hook, while
   * our side-effect parses the receipt and records the draft.
   */
  const onUpload = useCallback(async (file: NativeFileInput) => {
    lastImageUriRef.current = file.uri;
    setState({ status: "parsing", draft: null, error: null });
    const base64 = await readUriAsBase64(file.uri);
    const parse = parseReceiptImage(base64, file.mimeType);
    pendingRef.current = parse;
    try {
      const draft = await parse;
      draftRef.current = draft;
      setState({ status: "ready", draft, error: null });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to parse receipt.";
      draftRef.current = null;
      setState({ status: "error", draft: null, error: message });
      // Re-throw so the hook marks the attachment upload as failed too.
      throw err;
    } finally {
      if (pendingRef.current === parse) pendingRef.current = null;
    }
    // The attachment itself carries the original image bytes back into chat.
    return { type: "data", value: base64, mimeType: file.mimeType } as const;
  }, []);

  const { processFiles } = useAttachments({
    config: {
      enabled: true,
      accept: "image/*",
      maxSize,
      onUpload,
    },
  });

  const captureReceiptFile = useCallback(
    async (file: NativeFileInput) => {
      // Route through the hook so its validation (accept/size) + state apply.
      await processFiles([file]);
    },
    [processFiles],
  );

  const getDraft = useCallback(() => draftRef.current, []);

  const reset = useCallback(() => {
    draftRef.current = null;
    pendingRef.current = null;
    setState({ status: "idle", draft: null, error: null });
  }, []);

  // ── Register the `parseReceipt` frontend tool ──────────────────────────
  // The `handler` surfaces the parsed draft to the agent (which then proposes
  // the transaction via the separately-registered `addTransaction` tool — we
  // deliberately do not call it here). The `render` shows the user a rich
  // in-chat preview card with a thumbnail of the receipt + extracted fields.
  useFrontendTool(
    {
      name: TOOLS.parseReceipt,
      description:
        "Return the most recently attached receipt, parsed into structured " +
        "fields {merchant, amount, currency, date, suggestedCategory}. Call " +
        "this after the user attaches a receipt photo, then use the returned " +
        "fields to propose a transaction via addTransaction.",
      parameters: parseReceiptParameters,
      ...(agentId ? { agentId } : {}),
      handler: async () => {
        // If an upload is mid-flight, await it so the agent gets the draft
        // rather than a premature "no receipt" miss.
        if (pendingRef.current) {
          try {
            return await pendingRef.current;
          } catch {
            /* fall through to the stored error below */
          }
        }
        if (draftRef.current) {
          return draftRef.current;
        }
        return {
          error:
            "No receipt has been parsed yet. Ask the user to attach a receipt photo first.",
        };
      },
      render: () => {
        const draft = draftRef.current;
        if (!draft) return null;
        return (
          <ReceiptPreviewCard
            draft={draft}
            imageUri={lastImageUriRef.current ?? undefined}
          />
        );
      },
    },
    [agentId],
  );

  const api = useMemo<ReceiptCaptureApi>(
    () => ({ ...state, captureReceiptFile, getDraft, reset }),
    [state, captureReceiptFile, getDraft, reset],
  );

  return (
    <ReceiptCaptureContext.Provider value={api}>
      {children}
    </ReceiptCaptureContext.Provider>
  );
}
