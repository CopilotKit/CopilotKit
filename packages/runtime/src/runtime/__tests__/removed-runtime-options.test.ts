import { HttpAgent } from "@ag-ui/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotKitRuntime } from "../core/runtime";

const agents = { default: new HttpAgent({ url: "http://localhost:8000" }) };

/** A `CopilotKitRemovedApiError` whose message contains `message`. */
function removalError(message: string) {
  return expect.objectContaining({
    name: "CopilotKitRemovedApiError",
    code: "REMOVED_API",
    message: expect.stringContaining(message),
  });
}

/** The start of the message for a removed option. */
function removedOption(option: string) {
  return `The "${option}" option of CopilotKitRuntime was removed in CopilotKit 2.0.`;
}

/** The removal warnings among the calls of a `console.warn` spy. */
function removalWarnings(warn: { mock: { calls: unknown[][] } }) {
  return warn.mock.calls
    .map(([message]) => message)
    .filter(
      (message) =>
        typeof message === "string" &&
        message.includes("was removed in CopilotKit 2.0."),
    );
}

describe("CopilotKitRuntime with the options of the 1.x CopilotRuntime", () => {
  afterEach(() => vi.restoreAllMocks());

  it("throws the removal error for serviceAdapter, with the replacement", () => {
    expect(
      () =>
        new CopilotKitRuntime({
          agents,
          // @ts-expect-error -- 2.0 types the 1.x option as never
          serviceAdapter: {},
        }),
    ).toThrow(
      removalError(
        'The "serviceAdapter" option of CopilotKitRuntime was removed in CopilotKit 2.0. Run the model in a BuiltInAgent from @copilotkit/runtime/agent, and pass it in agents, for example agents: { default: new BuiltInAgent({ model: openaiText("gpt-5") }) }. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/removed-apis-2.0#runtime-options',
      ),
    );
  });

  it.each([
    "delegateAgentProcessingToServiceAdapter",
    "remoteEndpoints",
    "remoteActions",
    "langserve",
    "actions",
    "mcpServers",
    "createMCPClient",
    "middleware",
  ])("throws the removal error for %s, which cannot work in 2.0", (option) => {
    expect(() => new CopilotKitRuntime({ agents, [option]: [] })).toThrow(
      removalError(removedOption(option)),
    );
  });

  it.each(["observability_c", "onError", "onStopGeneration"])(
    "only warns for %s, which 2.0 ignores",
    (option) => {
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      expect(
        () => new CopilotKitRuntime({ agents, [option]: () => undefined }),
      ).not.toThrow();
      expect(removalWarnings(warn)).toEqual([
        expect.stringContaining(removedOption(option)),
      ]);
    },
  );

  it("throws the removal error when code passes no options", () => {
    expect(
      // @ts-expect-error -- 2.0 needs the agents
      () => new CopilotKitRuntime(),
    ).toThrow(
      removalError(
        '"new CopilotRuntime()" without options was removed in CopilotKit 2.0.',
      ),
    );
  });

  it("neither throws nor warns for the options of 2.0", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(
      () =>
        new CopilotKitRuntime({
          agents,
          beforeRequestMiddleware: () => undefined,
        }),
    ).not.toThrow();
    expect(removalWarnings(warn)).toEqual([]);
  });
});
