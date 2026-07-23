"use client";

/**
 * Two buttons that auto-attach a bundled sample file (image or PDF) and
 * immediately submit a canned prompt about it.
 *
 * Implementation note: an earlier version of this component drove the
 * chat's hidden `<input type="file">` via DataTransfer + a synthetic
 * `change` event so the sample path went through the same `onUpload` /
 * `useAttachments` pipeline as the paperclip button. That worked for
 * "queue the attachment" but auto-sending the canned prompt afterwards
 * required clicking the send button while the attachment was still in
 * `status: "uploading"`, which `CopilotChat.onSubmitInput` rejects with
 * `"Cannot send while attachments are uploading"` and clears the input
 * regardless. Detecting the upload-complete state from outside the chat
 * meant scraping the spinner overlay, racy on slow renders.
 *
 * This version skips the DOM entirely and goes through the V2 agent
 * surface directly: `agent.addMessage(...)` to enqueue a fully-formed
 * user message (text + attachment content parts), then
 * `copilotkit.runAgent({ agent })` to dispatch it. Matches what
 * `CopilotChat.onSubmitInput` does internally — same shapes, same
 * runtime — but with no upload race because we build the
 * already-base64'd content part ourselves before calling addMessage.
 *
 * The `LegacyConverterShim` in page.tsx still rewrites our modern
 * `image|document` parts to the legacy `binary` shape the published
 * `@ag-ui/langgraph` converter understands, so the agent ultimately
 * receives the attachment in the form `multimodal_agent.py` expects.
 */

import { useCallback, useState } from "react";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";

interface SampleSpec {
  readonly buttonLabel: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly testId: string;
  readonly fetchUrl: string;
  /**
   * Prompt sent alongside the attachment. Rendered as the user message
   * bubble in chat AND matched against by aimock to return the demo's
   * canned response. Phrased as a long, specific sentence ("demo pdf I
   * just attached" / "demo image I just attached") so it both reads
   * naturally and can't collide with arbitrary user prompts — random
   * uploads phrase questions differently and fall through to the proxy.
   */
  readonly autoPrompt: string;
}

const SAMPLES: readonly SampleSpec[] = [
  {
    buttonLabel: "Try with sample image",
    filename: "sample.png",
    mimeType: "image/png",
    testId: "multimodal-sample-image-button",
    fetchUrl: "/demo-files/sample.png",
    autoPrompt: "can you tell me what is in this demo image I just attached",
  },
  {
    buttonLabel: "Try with sample PDF",
    filename: "sample.pdf",
    mimeType: "application/pdf",
    testId: "multimodal-sample-pdf-button",
    fetchUrl: "/demo-files/sample.pdf",
    autoPrompt: "can you tell me what is in this demo pdf I just attached",
  },
];

export interface SampleAttachmentButtonsProps {
  /**
   * Agent slug the parent `<CopilotKit agent="...">` provider wires up.
   * The buttons send via `useAgent({ agentId })` so the message lands on
   * the same agent the sibling `<CopilotChat />` is bound to.
   */
  readonly agentId: string;
}

/**
 * Magic-byte prefixes used to validate fetched sample files. We check
 * these because Next.js will happily serve a Git LFS *pointer* file (a
 * short plain-text stub starting with `version https://git-lfs...`) with
 * a `Content-Type: image/png` header if LFS wasn't pulled at build time.
 * Without this guard, the broken pointer bytes get base64-encoded,
 * sent to the agent as a valid-looking PNG, and rendered as a broken
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

interface FetchedSample {
  bytes: Uint8Array;
  base64: string;
  size: number;
}

/**
 * Fetch the sample file, validate its magic bytes, and return both the
 * raw bytes (for size accounting) and a base64 string suitable for
 * dropping into a `source.value` content part.
 */
async function fetchSample(spec: SampleSpec): Promise<FetchedSample> {
  const res = await fetch(spec.fetchUrl);
  if (!res.ok) {
    throw new Error(
      `Could not fetch sample "${spec.filename}" — HTTP ${res.status}. ` +
        `Is the file bundled under public${spec.fetchUrl}?`,
    );
  }
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);

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

  // Convert to base64 via FileReader for parity with the paperclip path.
  // The `data:<mime>;base64,<payload>` URL is split — we only need the
  // payload, which becomes the `source.value` of the content part below.
  const blob = new Blob([buffer], { type: spec.mimeType });
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(
        reader.error ?? new Error(`FileReader failed for ${spec.filename}`),
      );
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Unexpected FileReader result for ${spec.filename}`));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
  const commaIdx = dataUrl.indexOf(",");
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;

  return { bytes, base64, size: buffer.byteLength };
}

/**
 * Browser-friendly UUID. `crypto.randomUUID` is widely supported but we
 * fall back to a math-based UUIDv4 for the (rare) older runtime.
 */
function generateMessageId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function SampleAttachmentButtons({
  agentId,
}: SampleAttachmentButtonsProps) {
  const { agent } = useAgent({ agentId });
  const { copilotkit } = useCopilotKit();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendSample = useCallback(
    async (spec: SampleSpec): Promise<void> => {
      setError(null);
      setLoading(spec.testId);
      try {
        if (!agent) {
          throw new Error(
            `Agent "${agentId}" is not yet available. Try again in a moment.`,
          );
        }
        const sample = await fetchSample(spec);
        const partType =
          spec.mimeType === "application/pdf" ? "document" : "image";

        // Build a multimodal user message as content parts: prompt text +
        // the attachment. The `LegacyConverterShim` in page.tsx will
        // rewrite the modern `image|document` part to the legacy `binary`
        // shape the @ag-ui/langgraph converter understands before the
        // request leaves the runtime.
        agent.addMessage({
          id: generateMessageId(),
          role: "user",
          content: [
            { type: "text", text: spec.autoPrompt },
            {
              type: partType,
              source: {
                type: "data",
                value: sample.base64,
                mimeType: spec.mimeType,
              },
              metadata: {
                filename: spec.filename,
                size: sample.size,
              },
            },
          ],
        } as Parameters<typeof agent.addMessage>[0]);

        await copilotkit.runAgent({ agent });
      } catch (err) {
        console.error("[multimodal-demo] sample-attachment send failed", err);
        setError(err instanceof Error ? err.message : "Sample send failed.");
      } finally {
        setLoading(null);
      }
    },
    [agent, agentId, copilotkit],
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
            onClick={() => void sendSample(spec)}
            className="rounded border border-black/15 bg-white px-3 py-1 text-xs font-medium text-black transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-neutral-900 dark:text-white dark:hover:bg-white/5"
          >
            {isLoading ? "Sending…" : spec.buttonLabel}
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
