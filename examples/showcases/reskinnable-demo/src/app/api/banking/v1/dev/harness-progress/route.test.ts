import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "./[channel]/route";
import {
  clearProgress,
  publishProgress,
} from "@/skins/banking/harness/progress";

const CH = "sse-channel";

const readAll = async (body: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
};

describe("GET harness-progress/[channel]", () => {
  beforeEach(() => clearProgress(CH));

  it("replays the backlog then closes on the done frame", async () => {
    publishProgress(CH, { kind: "thinking", text: "reading csv", at: 1 });
    publishProgress(CH, { kind: "tool", label: "web_search", at: 2 });
    publishProgress(CH, { kind: "done", at: 3 });

    const response = await GET(new Request("http://test"), {
      params: Promise.resolve({ channel: CH }),
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const text = await readAll(response.body!);
    expect(text).toContain('"kind":"thinking"');
    expect(text).toContain('"label":"web_search"');
    expect(text.match(/^data: /gm)).toHaveLength(3);
  });

  it("closes on an error frame too", async () => {
    publishProgress(CH, { kind: "error", message: "codex exited 1", at: 1 });
    const response = await GET(new Request("http://test"), {
      params: Promise.resolve({ channel: CH }),
    });
    expect(await readAll(response.body!)).toContain("codex exited 1");
  });
});
