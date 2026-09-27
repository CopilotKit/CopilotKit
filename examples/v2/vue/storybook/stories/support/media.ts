/**
 * Offline sample media for attachment stories. Everything is generated in the
 * browser (inline SVG, synthesized WAV/PDF, a canvas-recorded clip), so no
 * story fetches an asset.
 */
import type { Attachment } from "@copilotkit/vue";

const toBase64 = (text: string) => btoa(unescape(encodeURIComponent(text)));

/** A small illustrative "photo" as base64 SVG. */
export const sampleImageBase64 = (hueA: number, hueB: number) =>
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
export const sampleAudioBase64 = (() => {
  const sampleRate = 8000;
  const seconds = 1.2;
  const samples = Math.floor(sampleRate * seconds);
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
export const samplePdfBase64 = toBase64(`%PDF-1.4
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

export const sampleTextBase64 = toBase64(
  "Meeting notes — Sept 24\n\n- Ship the checkout redesign behind a flag\n- Interview three enterprise customers\n- Revisit pricing tiers next sprint\n",
);

/**
 * Records a short canvas animation to a WebM blob URL, so video attachments
 * have a real, playable source without a network asset. Resolves to
 * `undefined` where MediaRecorder or canvas capture is unavailable.
 */
export async function recordSampleVideoUrl(
  durationMs = 600,
): Promise<string | undefined> {
  if (typeof MediaRecorder === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (!ctx || !("captureStream" in canvas)) return undefined;

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);

  let frame = 0;
  const draw = () => {
    const gradient = ctx.createLinearGradient(0, 0, 320, 180);
    gradient.addColorStop(0, "hsl(250 70% 60%)");
    gradient.addColorStop(1, "hsl(190 70% 45%)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.beginPath();
    ctx.arc(60 + ((frame * 6) % 200), 90, 26, 0, Math.PI * 2);
    ctx.fill();
    frame += 1;
  };
  draw();
  const timer = setInterval(draw, 33);

  const done = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start();
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  recorder.stop();
  await done;
  clearInterval(timer);
  stream.getTracks().forEach((track) => track.stop());
  return URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
}

const data = (mimeType: string, value: string): Attachment["source"] => ({
  type: "data",
  mimeType,
  value,
});

export const imageAttachment = (
  id: string,
  hues: [number, number],
  filename = "screenshot.png",
): Attachment => ({
  id,
  type: "image",
  source: data("image/svg+xml", sampleImageBase64(hues[0], hues[1])),
  filename,
  size: 184_320,
  status: "ready",
});

export const pdfAttachment: Attachment = {
  id: "pdf",
  type: "document",
  source: data("application/pdf", samplePdfBase64),
  filename: "Q3-launch-plan.pdf",
  size: 248_000,
  status: "ready",
};

export const textAttachment: Attachment = {
  id: "txt",
  type: "document",
  source: data("text/plain", sampleTextBase64),
  filename: "meeting-notes.txt",
  size: 1_240,
  status: "ready",
};

export const spreadsheetAttachment: Attachment = {
  id: "xlsx",
  type: "document",
  source: data(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "",
  ),
  filename: "revenue-forecast-2026.xlsx",
  size: 96_500,
  status: "ready",
};

export const docAttachment: Attachment = {
  id: "docx",
  type: "document",
  source: data(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "",
  ),
  filename: "press-release-draft.docx",
  size: 41_000,
  status: "ready",
};

export const audioAttachment: Attachment = {
  id: "audio",
  type: "audio",
  source: data("audio/wav", sampleAudioBase64),
  filename: "voice-memo.wav",
  size: 19_244,
  status: "ready",
};

/** A video attachment; the queue shows its thumbnail, the lightbox plays `url`. */
export const videoAttachment = (url = ""): Attachment => ({
  id: "video",
  type: "video",
  source: { type: "url", value: url, mimeType: "video/webm" },
  thumbnail: `data:image/svg+xml;base64,${sampleImageBase64(250, 190)}`,
  filename: "product-demo.webm",
  size: 3_400_000,
  status: "ready",
});
