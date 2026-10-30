import { expect, test } from "vitest";

import {
  resolveLearningContainerId,
  resolveTrajectoryLearningContainerIds,
} from "../learning";

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

test.each([
  { label: "duplicates", value: ["a", "a", "b"], expected: ["a", "b"] },
  { label: "explicit empty array", value: [], expected: [] },
  { label: "null", value: null, expected: undefined },
  { label: "undefined", value: undefined, expected: undefined },
])("Trajectory selector normalizes $label", async ({ value, expected }) => {
  await expect(
    resolveTrajectoryLearningContainerIds(() => value, {
      trajectoryId: "trajectory-1",
      user: { id: "user-1", name: "User" },
    }),
  ).resolves.toEqual(expected);
});

test.each([
  {
    label: "101 IDs",
    value: Array.from({ length: 101 }, (_, index) => `space-${index}`),
  },
  { label: "a scalar string", value: "a" },
  { label: "an empty ID", value: [""] },
  { label: "a numeric ID", value: [123] },
])(
  "Trajectory selector rejects $label at the JavaScript boundary",
  async ({ value }) => {
    const result = Reflect.apply(
      resolveTrajectoryLearningContainerIds,
      undefined,
      [
        () => value,
        { trajectoryId: "trajectory-1", user: { id: "user-1", name: "User" } },
      ],
    );
    await expect(result).rejects.toThrow(/Learning Container/);
  },
);
