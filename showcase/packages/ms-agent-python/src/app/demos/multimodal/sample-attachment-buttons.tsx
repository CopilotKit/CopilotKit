"use client";

/**
 * Two buttons that inject bundled sample files into the active CopilotChat's
 * attachment queue. The queue is owned internally by <CopilotChat /> (via its
 * `useAttachments` hook), so we inject at the DOM level: find the hidden
 * `<input type="file">` CopilotChat renders, populate its `.files` via
 * DataTransfer, and dispatch a `change` event. This exercises the *same*
 * onChange handler the paperclip / drag-and-drop paths use -- which means our
 * sample path runs through the `AttachmentsConfig.onUpload` the page wires
 * on the chat, the same file-size + accept-filter validation, the same
 * placeholder-then-ready lifecycle. No duplicated queueing code.
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
   * rendered around `<CopilotChat />`.
   */
  readonly rootSelector: string;
}

function findChatFileInput(rootSelector: string): HTMLInputElement | null {
  if (typeof document === "undefined") return null;
  const root = document.querySelector(rootSelector);
  if (!root) return null;
  return root.querySelector<HTMLInputElement>('input[type="file"]');
}

async function fetchAsFile(spec: SampleSpec): Promise<File> {
  const res = await fetch(spec.fetchUrl);
  if (!res.ok) {
    throw new Error(
      `Could not fetch sample "${spec.filename}" -- HTTP ${res.status}. ` +
        `Is the file bundled under public${spec.fetchUrl}?`,
    );
  }
  const blob = await res.blob();
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
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;

        // Dispatch a bubbling `change` event.
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
            {isLoading ? "Loading..." : spec.buttonLabel}
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
