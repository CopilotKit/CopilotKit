import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { TranscriptionErrorCode } from "@copilotkit/shared";
import type { AttachmentsConfig } from "@copilotkit/shared";
import { CopilotKitCore } from "../../core/core";
import { ɵAttachmentQueue } from "../attachment-queue";
import { CopilotChatDefaultLabels } from "../labels";
import {
  TranscriptionError,
  type TranscriptionErrorInfo,
} from "../transcription";
import {
  ɵappendTranscript,
  ɵcreateChatSubmitter,
  ɵresolveChatNotice,
  ɵstopAgentWithFallback,
  ɵtranscriptionErrorNotice,
  ɵTRANSCRIPTION_ERROR_TIMEOUT_MS,
  ɵwaitForActiveRun,
} from "../session";
import type { ɵChatSubmitterOptions } from "../session";
import { ɵThreadSwitchCoordinator } from "../thread-switch";
import { CursorAgent, deferred, flush } from "./session-test-agent";

/**
 * The core calls a chat makes. `runAgent` stands in for the network run:
 * it records the messages the run started with and can be held open.
 */
function createCore() {
  const runs: { agent: AbstractAgent; runId?: string; texts: string[] }[] = [];
  let runGate: Promise<void> = Promise.resolve();
  const stopped: AbstractAgent[] = [];
  const core: ɵChatSubmitterOptions["core"] = {
    runtimeUrl: "https://runtime.example/api/copilotkit",
    runtimeTransport: "rest",
    credentials: undefined,
    resolveHeaders: () => ({}),
    runAgent: async ({ agent, runId }) => {
      runs.push({
        agent,
        runId,
        texts: agent.messages.map((m) =>
          typeof m.content === "string" ? m.content : "[parts]",
        ),
      });
      await runGate;
      return { result: undefined, newMessages: [] };
    },
    stopAgent: ({ agent }) => {
      stopped.push(agent);
    },
  };
  return {
    core,
    runs,
    stopped,
    holdRuns: (gate: Promise<void>) => (runGate = gate),
  };
}

function setup(overrides: Partial<ɵChatSubmitterOptions> = {}) {
  const harness = createCore();
  const agent = new CursorAgent({ agentId: "chat", threadId: "t1" });
  let inputValue = "";
  const submitter = ɵcreateChatSubmitter({
    core: harness.core,
    getAgent: () => agent,
    input: { get: () => inputValue, set: (value) => (inputValue = value) },
    ...overrides,
  });
  return {
    ...harness,
    agent,
    submitter,
    input: () => inputValue,
    setInput: (value: string) => (inputValue = value),
  };
}

function attachmentQueue(config: Partial<AttachmentsConfig> = {}) {
  return new ɵAttachmentQueue(() => ({ enabled: true, ...config }));
}

const userTexts = (agent: AbstractAgent) =>
  agent.messages.filter((m) => m.role === "user").map((m) => m.content);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ɵChatSubmitter.submit", () => {
  it("adds the user message, clears the input and runs the agent", async () => {
    const { submitter, agent, runs, input, setInput } = setup();
    setInput("hello");

    await submitter.submit("hello");

    expect(userTexts(agent)).toEqual(["hello"]);
    expect(input()).toBe("");
    expect(runs.map((run) => run.texts)).toEqual([["hello"]]);
  });

  it("ignores blank text", async () => {
    const { submitter, agent, runs } = setup();

    await submitter.submit("   ");

    expect(agent.messages).toEqual([]);
    expect(runs).toEqual([]);
  });

  it("waits for the run in flight before sending the next message", async () => {
    const { submitter, runs, holdRuns } = setup();
    const firstRun = deferred();
    holdRuns(firstRun.promise);

    const first = submitter.submit("one");
    await flush();
    const second = submitter.submit("two");
    await flush();
    expect(runs).toHaveLength(1);
    holdRuns(Promise.resolve());
    firstRun.resolve();
    await Promise.all([first, second]);

    expect(runs.map((run) => run.texts)).toEqual([["one"], ["one", "two"]]);
  });

  it("sends the ready attachments with the text", async () => {
    const attachments = attachmentQueue({
      onUpload: () => ({ type: "url", value: "https://cdn/a.png" }),
    });
    await attachments.processFiles([
      new File(["x"], "a.png", { type: "image/png" }),
    ]);
    const { submitter, agent } = setup({ attachments });

    await submitter.submit("look");

    expect(userTexts(agent)).toEqual([
      [
        { type: "text", text: "look" },
        {
          type: "image",
          source: { type: "url", value: "https://cdn/a.png" },
          metadata: { filename: "a.png" },
        },
      ],
    ]);
    expect(attachments.getSnapshot()).toEqual([]);
  });

  it("blocks a send while an attachment uploads and shows a notice", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const upload = deferred();
    const attachments = attachmentQueue({
      onUpload: async () => {
        await upload.promise;
        return { type: "url", value: "https://cdn/a.png" };
      },
    });
    void attachments.processFiles([
      new File(["x"], "a.png", { type: "image/png" }),
    ]);
    const { submitter, agent, input, setInput } = setup({ attachments });
    setInput("draft");

    await submitter.submit("draft");

    expect(agent.messages).toEqual([]);
    expect(input()).toBe("draft");
    expect(submitter.getSnapshot().notice).toEqual({
      labelKey: "chatAttachmentsUploadingText",
    });
    upload.resolve();
  });

  it("restores the text when an upload starts while the send waits", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const attachments = attachmentQueue({
      onUpload: () => new Promise(() => {}),
    });
    const { submitter, agent, input, holdRuns } = setup({ attachments });
    const firstRun = deferred();
    holdRuns(firstRun.promise);
    const first = submitter.submit("one");
    await flush();

    const second = submitter.submit("two");
    void attachments.processFiles([
      new File(["x"], "a.png", { type: "image/png" }),
    ]);
    firstRun.resolve();
    await Promise.all([first, second]);

    expect(userTexts(agent)).toEqual(["one"]);
    expect(input()).toBe("two");
    expect(submitter.getSnapshot().notice).toEqual({
      labelKey: "chatAttachmentsUploadingText",
    });
  });

  it("drops a queued send when the user switches threads while it waits", async () => {
    const harness = createCore();
    const threads = new ɵThreadSwitchCoordinator(new CopilotKitCore({}));
    const agent = new CursorAgent({ agentId: "chat" });
    threads.select({ agent, threadId: "t1", explicit: true });
    const submitter = ɵcreateChatSubmitter({
      core: harness.core,
      getAgent: () => agent,
      input: { get: () => "", set: () => {} },
      threads,
    });
    const firstRun = deferred();
    harness.holdRuns(firstRun.promise);
    const first = submitter.submit("one");
    await flush();

    const second = submitter.submit("two");
    threads.select({ agent, threadId: "t2", explicit: true });
    firstRun.resolve();
    await Promise.all([first, second]);

    expect(harness.runs).toHaveLength(1);
  });

  it("puts the text back and shows a notice when the thread failed to load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const harness = createCore();
    const threads = new ɵThreadSwitchCoordinator(new CopilotKitCore({}));
    const agent = new CursorAgent({ agentId: "chat" });
    const selection = threads.select({ agent, threadId: "t1", explicit: true });
    await threads.trackConnection(selection, async () => {
      throw new Error("404");
    });
    let inputValue = "hello";
    const submitter = ɵcreateChatSubmitter({
      core: harness.core,
      getAgent: () => agent,
      input: { get: () => inputValue, set: (value) => (inputValue = value) },
      threads,
    });

    await submitter.submit("hello");

    expect(harness.runs).toEqual([]);
    expect(inputValue).toBe("hello");
    expect(submitter.getSnapshot().notice).toEqual({
      labelKey: "threadLoadErrorText",
    });
  });

  it("starts the run with the id prepareRun gives and settles it after", async () => {
    const settled: string[] = [];
    const { submitter, runs } = setup({
      prepareRun: () => ({
        runId: "run-1",
        settle: () => settled.push("run-1"),
      }),
    });

    await submitter.submit("hello");

    expect(runs.map((run) => run.runId)).toEqual(["run-1"]);
    expect(settled).toEqual(["run-1"]);
  });
});

describe("ɵChatSubmitter.selectSuggestion", () => {
  it("sends the suggestion's message", async () => {
    const { submitter, agent } = setup();

    await submitter.selectSuggestion({
      message: "Plan a trip",
      isLoading: false,
    });

    expect(userTexts(agent)).toEqual(["Plan a trip"]);
  });

  it("ignores a suggestion that is still loading", async () => {
    const { submitter, agent, runs } = setup();

    await submitter.selectSuggestion({ message: "Plan", isLoading: true });

    expect(agent.messages).toEqual([]);
    expect(runs).toEqual([]);
  });
});

describe("ɵChatSubmitter.transcribe", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("appends the transcript to the typed text", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ text: " world ", size: 5, type: "a" })),
    );
    const { submitter, input, setInput } = setup();
    setInput("hello  ");

    await submitter.transcribe(new Blob(["audio"], { type: "audio/webm" }));

    expect(input()).toBe("hello world");
    expect(submitter.getSnapshot().isTranscribing).toBe(false);
  });

  it("shows a notice for a failed transcription and clears it after the timeout", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { submitter } = setup();

    await submitter.transcribe(new Blob(["audio"]));
    const notice = submitter.getSnapshot().notice;
    vi.advanceTimersByTime(ɵTRANSCRIPTION_ERROR_TIMEOUT_MS);

    expect(notice).toEqual({ labelKey: "transcriptionErrorNetworkText" });
    expect(submitter.getSnapshot().notice).toBeNull();
  });
});

describe("ɵChatSubmitter.stop", () => {
  it("stops the agent through core", () => {
    const { submitter, agent, stopped } = setup();

    submitter.stop();

    expect(stopped).toEqual([agent]);
  });
});

describe("ɵstopAgentWithFallback", () => {
  it("aborts the run directly when core's stop throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const agent = new CursorAgent();
    const abortRun = vi.spyOn(agent, "abortRun");

    ɵstopAgentWithFallback(
      {
        stopAgent: () => {
          throw new Error("no run");
        },
      },
      agent,
    );

    expect(abortRun).toHaveBeenCalledTimes(1);
  });
});

/**
 * An agent with an Intelligence-style completion promise for its run in
 * flight. AbstractAgent declares the field private, so it is set on the
 * instance.
 */
function agentWithRun(completion: Promise<void>, isRunning: boolean) {
  const agent = new CursorAgent();
  agent.isRunning = isRunning;
  Object.defineProperty(agent, "activeRunCompletionPromise", {
    value: completion,
  });
  return agent;
}

describe("ɵwaitForActiveRun", () => {
  it("waits for the run in flight to finish", async () => {
    const run = deferred();
    const agent = agentWithRun(run.promise, true);

    let settled = false;
    void ɵwaitForActiveRun(agent).then(() => (settled = true));
    await flush();
    expect(settled).toBe(false);
    run.resolve();
    await flush();

    expect(settled).toBe(true);
  });

  it("returns at once for an agent that is not running", async () => {
    const agent = agentWithRun(new Promise(() => {}), false);

    await expect(ɵwaitForActiveRun(agent)).resolves.toBeUndefined();
  });
});

describe("ɵappendTranscript", () => {
  it.each([
    { previous: "", transcript: "hi", expected: "hi" },
    { previous: " typed ", transcript: " more ", expected: "typed more" },
    { previous: "typed ", transcript: "  ", expected: "typed " },
  ])(
    "appends $transcript to $previous",
    ({ previous, transcript, expected }) => {
      expect(ɵappendTranscript(previous, transcript)).toBe(expected);
    },
  );
});

describe("ɵtranscriptionErrorNotice", () => {
  const info = (
    overrides: Partial<TranscriptionErrorInfo>,
  ): TranscriptionErrorInfo => ({
    code: TranscriptionErrorCode.PROVIDER_ERROR,
    message: "provider down",
    retryable: false,
    ...overrides,
  });

  it("uses a label for a known error", () => {
    expect(
      ɵtranscriptionErrorNotice(
        new TranscriptionError(
          info({ code: TranscriptionErrorCode.RATE_LIMITED }),
        ),
      ),
    ).toEqual({ labelKey: "transcriptionErrorRateLimitedText" });
  });

  it("uses the error's own message when no label fits", () => {
    expect(ɵtranscriptionErrorNotice(new TranscriptionError(info({})))).toEqual(
      { text: "provider down" },
    );
  });

  it("uses the generic label for an error that is not a transcription error", () => {
    expect(ɵtranscriptionErrorNotice(new Error("boom"))).toEqual({
      labelKey: "transcriptionErrorGenericText",
    });
  });
});

describe("ɵresolveChatNotice", () => {
  it("reads a label notice from the labels and a text notice as is", () => {
    expect(
      ɵresolveChatNotice(
        { labelKey: "chatAttachmentsUploadingText" },
        CopilotChatDefaultLabels,
      ),
    ).toBe("Cannot send while attachments are uploading.");
    expect(
      ɵresolveChatNotice({ text: "custom" }, CopilotChatDefaultLabels),
    ).toBe("custom");
  });
});
