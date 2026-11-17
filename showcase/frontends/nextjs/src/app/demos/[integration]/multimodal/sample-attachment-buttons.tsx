"use client";

/**
 * Two buttons that send a bundled sample file (an image or a PDF) to the
 * agent, together with a fixed prompt about it.
 *
 * The buttons build the user message themselves (the prompt text plus the
 * file as a base64 content part), add it to the agent with
 * `agent.addMessage(...)`, and start a run with `copilotkit.runAgent(...)`.
 * That is what the chat does when the user sends a message. The buttons do
 * not use the chat's hidden file input, because that path races the upload:
 * the chat refuses to send while an attachment is still uploading.
 *
 * The agent gets the same modern `image` and `document` parts as from an
 * upload.
 */

import { useCallback, useState } from "react";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { randomUUID, readFileAsBase64 } from "@copilotkit/shared";

export interface SampleSpec {
  readonly buttonLabel: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly testId: string;
  readonly fetchUrl: string;
  /**
   * The prompt sent with the file. The chat shows it as the user message,
   * and aimock matches it to answer with the demo's fixture. It is a long,
   * specific sentence, so it reads naturally and does not match a prompt a
   * user types about their own upload.
   */
  readonly autoPrompt: string;
}

export const SAMPLE_IMAGE: SampleSpec = {
  buttonLabel: "Try with sample image",
  filename: "sample.png",
  mimeType: "image/png",
  testId: "multimodal-sample-image-button",
  fetchUrl: "/demo-files/sample.png",
  autoPrompt: "can you tell me what is in this demo image I just attached",
};

export const SAMPLE_PDF: SampleSpec = {
  buttonLabel: "Try with sample PDF",
  filename: "sample.pdf",
  mimeType: "application/pdf",
  testId: "multimodal-sample-pdf-button",
  fetchUrl: "/demo-files/sample.pdf",
  autoPrompt: "can you tell me what is in this demo pdf I just attached",
};

const SAMPLES = [SAMPLE_IMAGE, SAMPLE_PDF];

/**
 * The first bytes of each sample type. A deploy without Git LFS serves the
 * LFS pointer file (a short text file that starts with
 * `version https://git-lfs...`) with an image or PDF content type. This check
 * stops the pointer from going to the agent as a broken PNG: the send fails
 * with a clear error instead.
 */
const MAGIC_BYTES: Record<string, number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47], // ‰PNG
  "application/pdf": [0x25, 0x50, 0x44, 0x46], // %PDF
};

const LFS_POINTER_PREFIX = "version https://git-lfs";

function bytesStartWith(bytes: Uint8Array, prefix: number[]) {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

/**
 * Fetches a sample file, checks that it is the real file, and returns it as
 * base64 with its size.
 */
async function fetchSample(spec: SampleSpec) {
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

  const file = new File([buffer], spec.filename, { type: spec.mimeType });
  return { base64: await readFileAsBase64(file), size: buffer.byteLength };
}

/** The part of the CopilotKit core that `submitSample` uses. */
type SampleSender = Pick<
  ReturnType<typeof useCopilotKit>["copilotkit"],
  "getAgent" | "runAgent"
>;

/**
 * Loads a sample and sends it, with its prompt, to the agent that the chat
 * uses.
 *
 * The agent is looked up by id after the file has loaded, never when the
 * button is clicked. If a click comes during runtime discovery, a lookup at
 * click time gets the stand-in agent that `useAgent` hands out until
 * discovery ends. The reply then goes where nothing renders it (PNI-575).
 *
 * @param copilotkit - The CopilotKit core, from `useCopilotKit()`.
 * @param agentId - The id of the agent that the chat uses.
 * @param spec - The sample to send.
 * @param load - Loads the sample. Defaults to fetching it from `public/`.
 * @throws Error when the sample cannot be loaded, or when no agent has the id.
 */
export async function submitSample(
  copilotkit: SampleSender,
  agentId: string,
  spec: SampleSpec,
  load = fetchSample,
) {
  const sample = await load(spec);
  const target = copilotkit.getAgent(agentId);
  if (target === undefined) {
    throw new Error(
      `Agent "${agentId}" is not available. Try again in a moment.`,
    );
  }

  target.addMessage({
    id: randomUUID(),
    role: "user",
    content: [
      { type: "text", text: spec.autoPrompt },
      {
        type: spec.mimeType === "application/pdf" ? "document" : "image",
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
  });

  await copilotkit.runAgent({ agent: target });
}

export function SampleAttachmentButtons({ agentId }: { agentId: string }) {
  const { isReady } = useAgent({ agentId });
  const { copilotkit } = useCopilotKit();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendSample = useCallback(
    async (spec: SampleSpec) => {
      // Until runtime discovery ends, there is no agent to send to yet.
      if (!isReady) return;
      setError(null);
      setLoading(spec.testId);
      try {
        await submitSample(copilotkit, agentId, spec);
      } catch (err) {
        console.error("[multimodal-demo] sample-attachment send failed", err);
        setError(err instanceof Error ? err.message : "Sample send failed.");
      } finally {
        setLoading(null);
      }
    },
    [agentId, copilotkit, isReady],
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
            disabled={!isReady || loading !== null}
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
