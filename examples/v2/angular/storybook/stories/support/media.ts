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
