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
 *
 * Asset delivery: the sample bytes are inlined as base64 constants in
 * `./sample-assets` and bundled into the client JS at build time. We used
 * to fetch them from `/demo-files/sample.{png,pdf}` in `public/`, but on
 * Railway deploys the LFS blobs are not materialized during the build, so
 * the `public/` tree served a short LFS-pointer text stub instead of the
 * real binary. Bundling the bytes removes that failure mode entirely —
 * the sample buttons now work offline, pre-deploy, and in any environment
 * that can run the app at all.
 */

import { useCallback, useState } from "react";

import {
  type InlineSampleAsset,
  SAMPLE_IMAGE,
  SAMPLE_PDF,
  inlineSampleToFile,
} from "./sample-assets";

interface SampleSpec {
  readonly buttonLabel: string;
  readonly testId: string;
  readonly asset: InlineSampleAsset;
}

const SAMPLES: readonly SampleSpec[] = [
  {
    buttonLabel: "Try with sample image",
    testId: "multimodal-sample-image-button",
    asset: SAMPLE_IMAGE,
  },
  {
    buttonLabel: "Try with sample PDF",
    testId: "multimodal-sample-pdf-button",
    asset: SAMPLE_PDF,
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
        // Decode the inlined base64 bytes into a File. No fetch, no
        // reliance on `public/` asset serving, no LFS materialization.
        const file = inlineSampleToFile(spec.asset);

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
