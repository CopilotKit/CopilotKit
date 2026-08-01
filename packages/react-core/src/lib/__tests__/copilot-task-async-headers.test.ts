import { describe, expect, it, vi } from "vitest";
import type { CopilotContextParams } from "../../context";
import { CopilotTask } from "../copilot-task";

describe("CopilotTask async headers", () => {
  it("waits for initial headers before creating the runtime request", async () => {
    let resolveHeaders!: () => void;
    const headersReady = new Promise<void>((resolve) => {
      resolveHeaders = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { generateCopilotResponse: { messages: [] } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const context = {
      actions: {},
      getContextString: () => "",
      getFunctionCallHandler: () => async () => undefined,
      copilotApiConfig: {
        chatApiEndpoint: "https://runtime.example/graphql",
        headers: {},
        waitForHeaders: () => headersReady,
        getHeaders: () => ({ Authorization: "Bearer task" }),
      },
    } as unknown as CopilotContextParams;

    const task = new CopilotTask({ instructions: "do the task" });
    const running = task.run(context);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();

    resolveHeaders();
    await running;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization"),
    ).toBe("Bearer task");
    fetchMock.mockRestore();
  });
});
