"use client";

/**
 * Two buttons that inject bundled sample files into the active CopilotChat's
 * attachment queue. The queue is owned internally by <CopilotChat /> (via its
 * `useAttachments` hook), so we inject at the DOM level: find the hidden
 * `<input type="file">` CopilotChat renders, populate its `.files` via
 * DataTransfer, and dispatch a `change` event. This exercises the *same*
 * onChange handler the paperclip / drag-and-drop paths use — which means our
 * sample path runs through the `AttachmentsConfig.onUpload` the page wires
 * on the chat, the same file-size + accept-filter validation, the same
 * placeholder-then-ready lifecycle. No duplicated queueing code.
 *
 * Container scope: the sample buttons live next to the chat inside a
 * `data-multimodal-demo-root` wrapper (see page.tsx). We scope our
 * `querySelector` to that root so multiple CopilotChat instances on the
 * page (there aren't any today, but the pattern should be safe) don't
 * collide.
 */

import { useCallback, useState } from "react";

interface SampleSpec {
  readonly buttonLabel: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly testId: string;
  readonly fetchUrl: string;
}

const SAMPLES: readonly SampleSpec[] = [
  {
    buttonLabel: "Try with sample image",
    filename: "sample.png",
    mimeType: "image/png",
    testId: "multimodal-sample-image-button",
    fetchUrl: "/demo-files/sample.png",
  },
  {
    buttonLabel: "Try with sample PDF",
    filename: "sample.pdf",
    mimeType: "application/pdf",
    testId: "multimodal-sample-pdf-button",
    fetchUrl: "/demo-files/sample.pdf",
  },
];

export interface SampleAttachmentButtonsProps {
  /**
   * Selector (scoped to `document`) that resolves to the wrapper element
   * rendered around `<CopilotChat />`. The component walks this element's
   * subtree to find the hidden file input CopilotChat renders.
   */
  readonly rootSelector: string;
}

function findChatFileInput(rootSelector: string): HTMLInputElement | null {
  if (typeof document === "undefined") return null;
  const root = document.querySelector(rootSelector);
  if (!root) return null;
  // CopilotChat renders exactly one hidden `<input type="file">` directly
  // inside its chatContainerRef div. Match on `type="file"` to avoid
  // sibling inputs (there are none today but it costs nothing to be
  // defensive).
  return root.querySelector<HTMLInputElement>('input[type="file"]');
}

/**
 * Magic-byte prefixes used to validate fetched sample files. We check
 * these because Next.js will happily serve a Git LFS *pointer* file (a
 * short plain-text stub starting with `version https://git-lfs...`) with
 * a `Content-Type: image/png` header if LFS wasn't pulled at build time.
 * Without this guard, the broken pointer bytes get base64-encoded,
 * fed into CopilotChat as a valid-looking PNG, and rendered as a broken
 * <img>. Fail loudly with an actionable error instead.
 */
const MAGIC_BYTES: Record<string, number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47], // ‰PNG
  "application/pdf": [0x25, 0x50, 0x44, 0x46], // %PDF
};

const LFS_POINTER_PREFIX = "version https://git-lfs";

function bytesStartWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

async function fetchAsFile(spec: SampleSpec): Promise<File> {
  const res = await fetch(spec.fetchUrl);
  if (!res.ok) {
    throw new Error(
      `Could not fetch sample "${spec.filename}" — HTTP ${res.status}. ` +
        `Is the file bundled under public${spec.fetchUrl}?`,
    );
  }
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Detect Git LFS pointer stub — the file on disk hasn't been materialized.
  const asciiHead = new TextDecoder("utf-8", { fatal: false }).decode(
    bytes.slice(0, Math.min(bytes.length, 64)),
  );
  if (asciiHead.startsWith(LFS_POINTER_PREFIX)) {
    throw new Error(
      `Sample "${spec.filename}" is a Git LFS pointer, not the real asset. ` +
        "The deploy environment needs to run `git lfs pull` (or set " +
        "`GIT_LFS_ENABLED=1`) so the binary is checked out before the Next.js " +
        "app serves it.",
    );
  }

  const expectedMagic = MAGIC_BYTES[spec.mimeType];
  if (expectedMagic && !bytesStartWith(bytes, expectedMagic)) {
    throw new Error(
      `Sample "${spec.filename}" does not have a valid ${spec.mimeType} ` +
        "signature. The file may be corrupted or a wrong asset was committed.",
    );
  }

  // Re-wrap the bytes into a blob/File with the explicit MIME type rather than
  // trusting whatever Content-Type the dev server returned.
  const blob = new Blob([buffer], { type: spec.mimeType });
  return new File([blob], spec.filename, { type: spec.mimeType });
}

export function SampleAttachmentButtons({
  rootSelector,
}: SampleAttachmentButtonsProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const injectSample = useCallback(
    async (spec: SampleSpec): Promise<void> => {
      setError(null);
      setLoading(spec.testId);
      try {
        const fileInput = findChatFileInput(rootSelector);
        if (!fileInput) {
          throw new Error(
            `CopilotChat file input not found under "${rootSelector}". ` +
              "Is <CopilotChat /> mounted with `attachments.enabled: true`?",
          );
        }
        const file = await fetchAsFile(spec);

        // Populate the file input's `.files` list via a fresh DataTransfer.
        // This is the only way to programmatically set `HTMLInputElement.files`
        // — assigning a plain array fails in every browser.
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;

        // Dispatch a bubbling `change` event. CopilotChat's internal
        // `useAttachments.handleFileUpload` listens on `onChange`, which
        // React wires up as a native `change` listener — so a standard
        // DOM Event with `bubbles: true` reaches it.
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (err) {
        console.error(
          "[multimodal-demo] sample-attachment injection failed",
          err,
        );
        setError(
          err instanceof Error ? err.message : "Sample injection failed.",
        );
      } finally {
        setLoading(null);
      }
    },
    [rootSelector],
  );

  return (
    <div
      data-testid="multimodal-sample-row"
      className="flex flex-wrap items-center gap-2 rounded-md border border-black/10 bg-black/[0.03] px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.04]"
    >
      <span className="text-xs font-medium text-black/60 dark:text-white/60">
        Bundled samples:
      </span>
      {SAMPLES.map((spec) => {
        const isLoading = loading === spec.testId;
        return (
          <button
            key={spec.testId}
            type="button"
            data-testid={spec.testId}
            disabled={loading !== null}
            onClick={() => void injectSample(spec)}
            className="rounded border border-black/15 bg-white px-3 py-1 text-xs font-medium text-black transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-neutral-900 dark:text-white dark:hover:bg-white/5"
          >
            {isLoading ? "Loading…" : spec.buttonLabel}
          </button>
        );
      })}
      {error && (
        <span
          data-testid="multimodal-sample-error"
          className="ml-auto max-w-[24rem] truncate text-xs text-red-600 dark:text-red-400"
          title={error}
        >
          {error}
        </span>
      )}
    </div>
  );
}
