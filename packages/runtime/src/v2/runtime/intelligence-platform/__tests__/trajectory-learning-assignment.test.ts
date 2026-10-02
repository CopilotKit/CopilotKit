import { expect, test, vi } from "vitest";
import { CopilotKitIntelligence } from "../client";

const trajectoryId = "550e8400-e29b-41d4-a716-446655440000";
const user = { id: "verified-user", name: "Verified User" };

test("Trajectory assignment uses a server selector with the resolved user and no Thread", async () => {
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      Response.json({ trajectoryId, joinToken: "join-token" }),
    );
  const selector = vi.fn(async () => ["expense-review"]);
  const intelligence = new CopilotKitIntelligence({
    apiKey: "project-key",
    apiUrl: "https://intelligence.example",
    wsUrl: "wss://realtime.example",
    getTrajectoryLearningContainerIds: selector,
  });
  try {
    await intelligence.ɵconnectTrajectory({ trajectoryId, user });

    expect(selector).toHaveBeenCalledExactlyOnceWith({ trajectoryId, user });
    expect(upstream).toHaveBeenCalledWith(
      "https://intelligence.example/api/trajectories/join",
      expect.objectContaining({
        body: JSON.stringify({
          trajectoryId,
          appUserId: user.id,
          learningContainerIds: ["expense-review"],
        }),
      }),
    );
  } finally {
    upstream.mockRestore();
  }
});

test("a selector can leave a Trajectory unassigned without changing the existing join contract", async () => {
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      Response.json({ trajectoryId, joinToken: "join-token" }),
    );
  const intelligence = new CopilotKitIntelligence({
    apiKey: "project-key",
    apiUrl: "https://intelligence.example",
    wsUrl: "wss://realtime.example",
    getTrajectoryLearningContainerIds: () => undefined,
  });
  try {
    await intelligence.ɵconnectTrajectory({ trajectoryId, user });

    expect(upstream).toHaveBeenCalledWith(
      "https://intelligence.example/api/trajectories/join",
      expect.objectContaining({
        body: JSON.stringify({ trajectoryId, appUserId: user.id }),
      }),
    );
  } finally {
    upstream.mockRestore();
  }
});

test("invalid server-selected container IDs fail before requesting a join token", async () => {
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      Response.json({ trajectoryId, joinToken: "join-token" }),
    );
  const intelligence = new CopilotKitIntelligence({
    apiKey: "project-key",
    apiUrl: "https://intelligence.example",
    wsUrl: "wss://realtime.example",
    getTrajectoryLearningContainerIds: () => ["invalid container"],
  });
  try {
    await expect(
      intelligence.ɵconnectTrajectory({ trajectoryId, user }),
    ).rejects.toThrow(/Learning Container/);

    expect(upstream).not.toHaveBeenCalled();
  } finally {
    upstream.mockRestore();
  }
});
