"use client";

/**
 * Two buttons that inject bundled sample files into the active CopilotChat's
 * attachment queue. The queue is owned internally by <CopilotChat /> via its
 * `useAttachments` hook, so we inject at the DOM level: find the hidden
 * `<input type="file">` CopilotChat renders, populate its `.files` via
 * DataTransfer, and dispatch a `change` event. This exercises the *same*
 * onChange handler the paperclip / drag-and-drop paths use.
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
  readonly rootSelector: string;
}

function findChatFileInput(rootSelector: string): HTMLInputElement | null {
  if (typeof document === "undefined") return null;
  const root = document.querySelector(rootSelector);
  if (!root) return null;
  return root.querySelector<HTMLInputElement>('input[type="file"]');
}

const MAGIC_BYTES: Record<string, number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "application/pdf": [0x25, 0x50, 0x44, 0x46],
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
      `Could not fetch sample "${spec.filename}" — HTTP ${res.status}.`,
    );
  }
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const asciiHead = new TextDecoder("utf-8", { fatal: false }).decode(
    bytes.slice(0, Math.min(bytes.length, 64)),
  );
  if (asciiHead.startsWith(LFS_POINTER_PREFIX)) {
    throw new Error(
      `Sample "${spec.filename}" is a Git LFS pointer, not the real asset.`,
    );
  }

  const expectedMagic = MAGIC_BYTES[spec.mimeType];
  if (expectedMagic && !bytesStartWith(bytes, expectedMagic)) {
    throw new Error(
      `Sample "${spec.filename}" does not have a valid ${spec.mimeType} signature.`,
    );
  }

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
            `CopilotChat file input not found under "${rootSelector}".`,
          );
        }
        const file = await fetchAsFile(spec);

        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;

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
      className="flex flex-wrap items-center gap-2 rounded-md border border-black/10 bg-black/[0.03] px-3 py-2 text-sm"
    >
      <span className="text-xs font-medium text-black/60">
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
            className="rounded border border-black/15 bg-white px-3 py-1 text-xs font-medium text-black transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "Loading…" : spec.buttonLabel}
          </button>
        );
      })}
      {error && (
        <span
          data-testid="multimodal-sample-error"
          className="ml-auto max-w-[24rem] truncate text-xs text-red-600"
          title={error}
        >
          {error}
        </span>
      )}
    </div>
  );
}
