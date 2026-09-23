import { expect, test } from "vitest";

import { resolveLearningContainerId } from "../learning";

test("rejects a non-string Learning Container ID returned by a callback", async () => {
  const config = {
    containerId: async (): Promise<unknown> => 123,
  };
  const context = {
    surface: "web",
    request: new Request("https://example.com/copilotkit"),
    threadId: "thread-1",
    runId: "run-1",
    agentId: "agent-1",
    userId: "user-1",
  };

  const result = Reflect.apply(resolveLearningContainerId, undefined, [
    config,
    context,
  ]);

  await expect(result).rejects.toThrow("stable ID");
});
