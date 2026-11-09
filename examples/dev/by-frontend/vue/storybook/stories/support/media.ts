/**
 * Offline sample media for attachment stories, the same as the React
 * storybook's `support/media.ts`: inline SVG and synthesized WAV and PDF, so
 * no story fetches an asset.
 */
import type { CopilotChatAttachmentRendererProps } from "@copilotkit/vue";

/** The renderer props of one sample attachment. */
export type SampleAttachment = Required<
  Pick<CopilotChatAttachmentRendererProps, "type" | "source" | "filename">
>;

const toBase64 = (text: string) => btoa(unescape(encodeURIComponent(text)));

/** A small illustrative "photo" as base64 SVG. */
const sampleImageBase64 = (hueA: number, hueB: number) =>
  toBase64(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${hueA} 70% 62%)"/>
        <stop offset="1" stop-color="hsl(${hueB} 70% 42%)"/>
      </linearGradient></defs>
      <rect width="480" height="320" fill="url(#g)"/>
      <circle cx="360" cy="90" r="42" fill="hsl(${hueA} 90% 88%)" opacity=".85"/>
      <path d="M0 250 L130 150 L230 230 L320 170 L480 270 L480 320 L0 320 Z" fill="hsl(${hueB} 60% 22%)" opacity=".55"/>
    </svg>`,
  );

/** A short sine "chime" as a base64 WAV (8 kHz, 16-bit mono). */
const sampleAudioBase64 = (() => {
  const sampleRate = 8000;
  const samples = Math.floor(sampleRate * 1.2);
  const buffer = new DataView(new ArrayBuffer(44 + samples * 2));
  const writeString = (offset: number, value: string) =>
    [...value].forEach((char, i) =>
      buffer.setUint8(offset + i, char.charCodeAt(0)),
    );
  writeString(0, "RIFF");
  buffer.setUint32(4, 36 + samples * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  buffer.setUint32(16, 16, true);
  buffer.setUint16(20, 1, true);
  buffer.setUint16(22, 1, true);
  buffer.setUint32(24, sampleRate, true);
  buffer.setUint32(28, sampleRate * 2, true);
  buffer.setUint16(32, 2, true);
  buffer.setUint16(34, 16, true);
  writeString(36, "data");
  buffer.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, t * 20) * Math.exp(-t * 3);
    const value = Math.sin(2 * Math.PI * 660 * t) * envelope * 0.5;
    buffer.setInt16(44 + i * 2, value * 0x7fff, true);
  }
  let binary = "";
  new Uint8Array(buffer.buffer).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
})();

/** A one-page PDF as base64. */
const samplePdfBase64 = toBase64(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 52>>stream
BT /F1 28 Tf 72 700 Td (Q3 launch plan) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`);

const data = (mimeType: string, value: string): SampleAttachment["source"] => ({
  type: "data",
  mimeType,
  value,
});

export const imageAttachment = (
  hues: [number, number],
  filename = "screenshot.png",
): SampleAttachment => ({
  type: "image",
  source: data("image/svg+xml", sampleImageBase64(hues[0], hues[1])),
  filename,
});

export const pdfAttachment: SampleAttachment = {
  type: "document",
  source: data("application/pdf", samplePdfBase64),
  filename: "Q3-launch-plan.pdf",
};

export const audioAttachment: SampleAttachment = {
  type: "audio",
  source: data("audio/wav", sampleAudioBase64),
  filename: "voice-memo.wav",
};
