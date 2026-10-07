import { describe, expect, it, vi } from "vitest";

// The component module imports the React hooks, whose package also pulls in
// CSS that Node cannot load. submitSample takes the core explicitly, so the
// hooks are never called here.
vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: vi.fn(),
  useCopilotKit: vi.fn(),
}));

import { SAMPLES, submitSample } from "./sample-attachment-buttons";
import type { FetchedSample, SampleSpec } from "./sample-attachment-buttons";

/**
 * PNI-575: the sample button used the agent object it captured at click time.
 * When the click raced runtime discovery, that object was the provisional
 * stand-in `useAgent` hands out before the runtime is known; discovery
 * finished while the sample was loading, the chat switched to the registered
 * agent, and the message and its reply went to the stand-in, which nothing
 * renders. Staging saw an empty chat and a 60-second probe timeout.
 *
 * These tests drive the send path with discovery finishing DURING the sample
 * load, which is exactly the window the old code got wrong.
 */

const IMAGE = SAMPLES.find((s) => s.mimeType === "image/png")!;

function fakeAgent(name: string) {
  return { name, addMessage: vi.fn() };
}

type FakeAgent = ReturnType<typeof fakeAgent>;

/**
 * A CopilotKit core whose registered agent changes while the sample loads:
 * `before` until the load settles, `after` from then on.
 */
function discoveryDuringLoad(
  before: FakeAgent | undefined,
  after: FakeAgent | undefined,
) {
  let current = before;
  const copilotkit = {
    getAgent: vi.fn((_id: string) => current),
    runAgent: vi.fn(async (_opts: { agent: FakeAgent }) => undefined),
  };
  const load = vi.fn(async (_spec: SampleSpec): Promise<FetchedSample> => {
    // Runtime discovery completes while the file is still being read.
    current = after;
    return { bytes: new Uint8Array([1]), base64: "AQ==", size: 1 };
  });
  return { copilotkit, load };
}

describe("submitSample", () => {
  it("sends to the agent registered once the sample has loaded, not an earlier one", async () => {
    const provisional = fakeAgent("provisional");
    const registered = fakeAgent("registered");
    const { copilotkit, load } = discoveryDuringLoad(provisional, registered);

    await submitSample(copilotkit as never, "multimodal-demo", IMAGE, load);

    expect(registered.addMessage).toHaveBeenCalledTimes(1);
    expect(copilotkit.runAgent).toHaveBeenCalledWith({ agent: registered });
    expect(provisional.addMessage).not.toHaveBeenCalled();
  });

  it("builds the user message from the prompt and the loaded file", async () => {
    const registered = fakeAgent("registered");
    const { copilotkit, load } = discoveryDuringLoad(undefined, registered);

    await submitSample(copilotkit as never, "multimodal-demo", IMAGE, load);

    const message = registered.addMessage.mock.calls[0]![0];
    expect(message.role).toBe("user");
    expect(message.content).toEqual([
      { type: "text", text: IMAGE.autoPrompt },
      {
        type: "image",
        source: { type: "data", value: "AQ==", mimeType: "image/png" },
        metadata: { filename: IMAGE.filename, size: 1 },
      },
    ]);
  });

  it("fails clearly instead of sending when no agent is registered", async () => {
    const { copilotkit, load } = discoveryDuringLoad(undefined, undefined);

    await expect(
      submitSample(copilotkit as never, "multimodal-demo", IMAGE, load),
    ).rejects.toThrow('Agent "multimodal-demo" is not available');
    expect(copilotkit.runAgent).not.toHaveBeenCalled();
  });
});
