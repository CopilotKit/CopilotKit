// Separate process fixture: real adapter/SDK storage, deterministic model only.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Agent, FileStorage, SessionManager } from "@strands-agents/sdk";
import type { InputContent, RunAgentInput } from "@ag-ui/core";
import { EventSchema } from "@ag-ui/core/schemas";
import { ShowcaseStrandsAgent } from "../agent";
import { RecordingModel } from "./recording-model";

const [directory, phase, audio] = process.argv.slice(2);
if (!directory || !["write", "reload"].includes(phase)) {
  throw new Error("Expected storage directory and write/reload phase");
}
const specs = [
  ["image", "image/png", "original image.png"],
  ["document", "application/pdf", "original document.pdf"],
  ["video", "video/mp4", "original video.mp4"],
  ["document", "text/plain", "original note.txt"],
  ["audio", "audio/wav", "original audio.wav"],
] as const;
const media: InputContent[] = specs.map(([type, mimeType, filename]) => ({
  type,
  source: {
    type: "data",
    mimeType,
    value: Buffer.from(`native persistence fixture: ${filename}`).toString(
      "base64",
    ),
  },
  metadata: { filename },
}));
const model = new RecordingModel();
const adapter = new ShowcaseStrandsAgent({
  agent: new Agent({ id: "media", model, printer: false }),
  name: "media",
  config: {
    audioInputSupported: audio === "enabled",
    sessionManagerProvider: ({ threadId }) =>
      new SessionManager({
        sessionId: threadId,
        storage: { snapshot: new FileStorage(directory) },
      }),
  },
});
const input: RunAgentInput = {
  threadId: "media-thread",
  runId: phase,
  messages: [
    {
      id: phase,
      role: "user",
      content:
        phase === "write"
          ? [{ type: "text", text: "Inspect attachments." }, ...media]
          : "Continue the same conversation.",
    },
  ],
  state: {},
  context: [],
  tools: [],
  forwardedProps: {},
};
const events = [];
for await (const event of adapter.run(input))
  events.push(EventSchema.parse(event));
await writeFile(
  join(directory, `${phase}.json`),
  JSON.stringify({
    pid: process.pid,
    input,
    events,
    requests: model.requests,
  }),
);
