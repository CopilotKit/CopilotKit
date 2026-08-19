import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestCopilotContext } from "../../test-helpers/copilot-context";
import { CopilotTask } from "../copilot-task";

const { generateCopilotResponse, functionCallHandler } = vi.hoisted(() => ({
  generateCopilotResponse: vi.fn(),
  functionCallHandler: vi.fn(),
}));

vi.mock("@copilotkit/runtime-client-gql", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@copilotkit/runtime-client-gql")>();

  return {
    ...actual,
    CopilotRuntimeClient: vi.fn(() => ({
      generateCopilotResponse,
    })),
  };
});

function createContext(overrides = {}) {
  return createTestCopilotContext({
    getFunctionCallHandler: () => functionCallHandler,
    ...overrides,
  });
}

function systemPromptFromLastRequest() {
  return generateCopilotResponse.mock.calls.at(-1)?.[0].data.messages[0]
    .textMessage.content;
}

describe("CopilotTask", () => {
  beforeEach(() => {
    generateCopilotResponse.mockClear();
    generateCopilotResponse.mockReturnValue({
      toPromise: () =>
        Promise.resolve({
          data: { generateCopilotResponse: { messages: [] } },
        }),
    });
    functionCallHandler.mockReset();
    vi.stubGlobal("window", { location: { href: "http://localhost" } });
  });

  it("includes active v2 readable context by default", async () => {
    const task = new CopilotTask({ instructions: "Do the task" });

    await task.run(
      createContext({
        getCopilotReadableContextString: () => 'User profile:\n{"name":"Ada"}',
      }),
    );

    expect(systemPromptFromLastRequest()).toContain(
      'User profile:\n{"name":"Ada"}',
    );
  });

  it("does not include readable context when includeCopilotReadable is false", async () => {
    const task = new CopilotTask({
      instructions: "Do the task",
      includeCopilotReadable: false,
    });

    await task.run(
      createContext({
        getCopilotReadableContextString: () => "Hidden readable context",
      }),
    );

    expect(systemPromptFromLastRequest()).not.toContain(
      "Hidden readable context",
    );
  });

  it("preserves explicit data with readable context", async () => {
    const task = new CopilotTask<{ selectedId: number }>({
      instructions: "Do the task",
    });

    await task.run(
      createContext({
        getCopilotReadableContextString: () => "Readable context",
      }),
      { selectedId: 42 },
    );

    const systemPrompt = systemPromptFromLastRequest();
    expect(systemPrompt).toContain('{"selectedId":42}');
    expect(systemPrompt).toContain("Readable context");
    expect(systemPrompt.indexOf('{"selectedId":42}')).toBeLessThan(
      systemPrompt.indexOf("Readable context"),
    );
  });
});
