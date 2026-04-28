"use client";

import { useState } from "react";

/**
 * Sample-audio button for the voice demo.
 *
 * Bypasses the microphone entirely: fetches a bundled audio clip from
 * /public, base64-encodes it, and POSTs the single-route transcription
 * envelope to the configured runtime URL. On success, invokes
 * `onTranscribed(text)` so the caller can populate the chat composer.
 *
 * Matches the payload shape `transcribeAudio()` in
 * `@copilotkit/react-core`'s transcription-client.ts uses when the runtime
 * is in single-route transport mode — the default for
 * `copilotRuntimeNextJSAppRouterEndpoint`.
 */
export interface SampleAudioButtonProps {
  /** Called with the transcribed text on success. */
  onTranscribed: (text: string) => void;
  /** Runtime URL to POST the transcribe envelope to. */
  runtimeUrl: string;
  /** Public path of the sample audio clip. */
  audioSrc: string;
  /** Caption shown next to the button — what the user should expect. */
  sampleLabel: string;
}

export function SampleAudioButton({
  onTranscribed,
  runtimeUrl,
  audioSrc,
  sampleLabel,
}: SampleAudioButtonProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function handleClick() {
    setStatus("loading");
    try {
      const audioRes = await fetch(audioSrc);
      if (!audioRes.ok) {
        throw new Error(`Failed to fetch sample audio: ${audioRes.status}`);
      }
      const blob = await audioRes.blob();
      const buffer = await blob.arrayBuffer();
      const base64 = bufferToBase64(buffer);
      const transcribeRes = await fetch(runtimeUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method: "transcribe",
          body: {
            audio: base64,
            mimeType: blob.type || "audio/wav",
            filename: "sample.wav",
          },
        }),
      });
      if (!transcribeRes.ok) {
        throw new Error(`Transcribe failed: ${transcribeRes.status}`);
      }
      const json = (await transcribeRes.json()) as { text?: string };
      if (!json.text) {
        throw new Error("Transcribe returned no text");
      }
      onTranscribed(json.text);
      setStatus("idle");
    } catch (err) {
      console.error("[voice-demo] sample transcription failed", err);
      setStatus("error");
    }
  }

  return (
    <div
      data-testid="voice-sample-audio"
      className="flex items-center gap-3 rounded-md border border-black/10 bg-black/[0.02] px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.02]"
    >
      <button
        type="button"
        data-testid="voice-sample-audio-button"
        onClick={handleClick}
        disabled={status === "loading"}
        className="rounded border border-black/10 bg-white px-3 py-1 text-xs font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:bg-black/30 dark:hover:bg-white/10"
      >
        {status === "loading" ? "Transcribing…" : "Play sample"}
      </button>
      <span className="text-black/60 dark:text-white/60">
        Sample: &ldquo;{sampleLabel}&rdquo;
      </span>
      {status === "error" && (
        <span
          data-testid="voice-sample-audio-error"
          className="ml-auto text-red-600 dark:text-red-400"
        >
          Error — see console
        </span>
      )}
    </div>
  );
}

function bufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize)),
    );
  }
  return btoa(binary);
}
