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

  it("replays an UNFINISHED backlog, then closes on the live done frame", async () => {
    // The backlog carries no terminal frame, so this is a client joining a run
    // that is still going — the case the replay exists for.
    publishProgress(CH, { kind: "thinking", text: "reading csv", at: 1 });
    publishProgress(CH, { kind: "tool", label: "web_search", at: 2 });

    const response = await GET(new Request("http://test"), {
      params: Promise.resolve({ channel: CH }),
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const pending = readAll(response.body!);
    publishProgress(CH, { kind: "done", at: 3 });

    const text = await pending;
    expect(text).toContain('"kind":"thinking"');
    expect(text).toContain('"label":"web_search"');
    expect(text.match(/^data: /gm)).toHaveLength(3);
  });

  // The console mounts on TOOL_CALL_START, BEFORE the server clears the channel,
  // so on the second run of a session this client can arrive while the previous
  // run's frames are still buffered. Replaying them would deliver that run's
  // `done` and freeze the console for the whole of the real run.
  it("does not replay a backlog whose run already finished", async () => {
    publishProgress(CH, { kind: "thinking", text: "previous run", at: 1 });
    publishProgress(CH, { kind: "done", at: 2 });

    const response = await GET(new Request("http://test"), {
      params: Promise.resolve({ channel: CH }),
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // The FIRST frame this client sees must be the live one, not the stale
    // backlog — and the stream must still be open to deliver it.
    const pending = reader.read();
    publishProgress(CH, { kind: "thinking", text: "fresh run", at: 3 });
    const first = decoder.decode((await pending).value);
    expect(first).toContain("fresh run");
    expect(first).not.toContain("previous run");
  });

  it("closes on an error frame", async () => {
    const response = await GET(new Request("http://test"), {
      params: Promise.resolve({ channel: CH }),
    });
    const pending = readAll(response.body!);
    publishProgress(CH, { kind: "error", message: "codex exited 1", at: 1 });
    expect(await pending).toContain("codex exited 1");
  });

  // The live tail is the route's whole purpose, and the two tests above only
  // replay an already-finished backlog. Here the reader is ALREADY WAITING when
  // the frame is published, so only the subscription can deliver it: a broken
  // fan-out hangs this test instead of passing green.
  it("streams a frame published while a client is tailing", async () => {
    const response = await GET(new Request("http://test"), {
      params: Promise.resolve({ channel: CH }),
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    const pendingThinking = reader.read();
    publishProgress(CH, {
      kind: "thinking",
      text: "searching merchants",
      at: 1,
    });
    const thinking = await pendingThinking;
    expect(decoder.decode(thinking.value)).toContain("searching merchants");

    const pendingDone = reader.read();
    publishProgress(CH, { kind: "done", at: 2 });
    expect(decoder.decode((await pendingDone).value)).toContain(
      '"kind":"done"',
    );

    // The terminal frame closed the stream rather than leaving the tail open.
    expect((await reader.read()).done).toBe(true);
  });

  // A tail that survives `clearProgress` is what the tool does at run START.
  // Deleting the channel on clear used to orphan this listener: the frames below
  // would reach nobody and the stream would never close.
  it("keeps tailing across a clearProgress at run start", async () => {
    publishProgress(CH, { kind: "thinking", text: "previous run", at: 1 });
    const response = await GET(new Request("http://test"), {
      params: Promise.resolve({ channel: CH }),
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Drain the replayed backlog frame from the previous run.
    expect(decoder.decode((await reader.read()).value)).toContain(
      "previous run",
    );

    clearProgress(CH);
    const pending = reader.read();
    publishProgress(CH, { kind: "thinking", text: "fresh run", at: 2 });
    expect(decoder.decode((await pending).value)).toContain("fresh run");

    publishProgress(CH, { kind: "done", at: 3 });
    expect(decoder.decode((await reader.read()).value)).toContain(
      '"kind":"done"',
    );
    expect((await reader.read()).done).toBe(true);
  });

  // A disconnect mid-run must not take the harness down with it: the run keeps
  // publishing after the reader is gone, and those publishes must be silent.
  it("survives a client disconnecting mid-run", async () => {
    const response = await GET(new Request("http://test"), {
      params: Promise.resolve({ channel: CH }),
    });
    const reader = response.body!.getReader();
    await reader.cancel();

    expect(() =>
      publishProgress(CH, { kind: "thinking", text: "still working", at: 1 }),
    ).not.toThrow();
    expect(() => publishProgress(CH, { kind: "done", at: 2 })).not.toThrow();
  });
});
