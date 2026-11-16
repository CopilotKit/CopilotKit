import { AbstractAgent } from "@ag-ui/client";
import { EMPTY } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
  SAMPLE_IMAGE,
  SAMPLE_PDF,
  submitSample,
} from "./sample-attachment-buttons";
import type { SampleSpec } from "./sample-attachment-buttons";

// The module imports the React hooks, and their package also loads CSS that
// Node cannot read. submitSample takes the core as an argument, so the tests
// never call the hooks.
vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: vi.fn(),
  useCopilotKit: vi.fn(),
}));

/**
 * PNI-575: the sample button used the agent it captured at click time. When
 * the click raced runtime discovery, that was the stand-in agent `useAgent`
 * hands out before discovery ends. Discovery ended while the sample loaded,
 * the chat switched to the registered agent, and the message and its reply
 * went to the stand-in, which nothing renders.
 *
 * These tests let discovery end DURING the sample load, which is the window
 * the old code got wrong.
 */

// An agent that never streams. The tests read the messages added to it.
class IdleAgent extends AbstractAgent {
  run() {
    return EMPTY;
  }
}

/**
 * A CopilotKit core whose registered agent changes while the sample loads:
 * `before` until the load ends, `after` from then on.
 */
function discoveryDuringLoad(
  before: AbstractAgent | undefined,
  after: AbstractAgent | undefined,
) {
  let registered = before;
  const copilotkit = {
    getAgent: () => registered,
    runAgent: vi.fn(async () => ({ result: undefined, newMessages: [] })),
  };
  const load = async () => {
    registered = after;
    return { base64: "AQ==", size: 1 };
  };
  return { copilotkit, load };
}

// Sends a sample while discovery registers an agent, and returns the
// messages that the registered agent got.
async function messagesSentFor(spec: SampleSpec) {
  const registered = new IdleAgent();
  const { copilotkit, load } = discoveryDuringLoad(undefined, registered);
  await submitSample(copilotkit, "multimodal-demo", spec, load);
  return registered.messages;
}

describe("submitSample", () => {
  it("sends to the agent registered once the sample has loaded, not an earlier one", async () => {
    const standIn = new IdleAgent();
    const registered = new IdleAgent();
    const { copilotkit, load } = discoveryDuringLoad(standIn, registered);

    await submitSample(copilotkit, "multimodal-demo", SAMPLE_IMAGE, load);

    expect(registered.messages).toHaveLength(1);
    expect(standIn.messages).toEqual([]);
    expect(copilotkit.runAgent).toHaveBeenCalledWith({ agent: registered });
  });

  it("sends the image sample as its prompt and an image part", async () => {
    expect(await messagesSentFor(SAMPLE_IMAGE)).toEqual([
      {
        id: expect.any(String),
        role: "user",
        content: [
          {
            type: "text",
            text: "can you tell me what is in this demo image I just attached",
          },
          {
            type: "image",
            source: { type: "data", value: "AQ==", mimeType: "image/png" },
            metadata: { filename: "sample.png", size: 1 },
          },
        ],
      },
    ]);
  });

  it("sends the PDF sample as its prompt and a document part", async () => {
    expect(await messagesSentFor(SAMPLE_PDF)).toEqual([
      {
        id: expect.any(String),
        role: "user",
        content: [
          {
            type: "text",
            text: "can you tell me what is in this demo pdf I just attached",
          },
          {
            type: "document",
            source: {
              type: "data",
              value: "AQ==",
              mimeType: "application/pdf",
            },
            metadata: { filename: "sample.pdf", size: 1 },
          },
        ],
      },
    ]);
  });

  it("fails clearly instead of sending when no agent is registered", async () => {
    const { copilotkit, load } = discoveryDuringLoad(undefined, undefined);

    await expect(
      submitSample(copilotkit, "multimodal-demo", SAMPLE_IMAGE, load),
    ).rejects.toThrow('Agent "multimodal-demo" is not available');
    expect(copilotkit.runAgent).not.toHaveBeenCalled();
  });
});
