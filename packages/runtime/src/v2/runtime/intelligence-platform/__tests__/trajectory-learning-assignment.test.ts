import { expect, test, vi } from "vitest";
import { logger } from "@copilotkit/shared";
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

    expect(selector).toHaveBeenCalledExactlyOnceWith(
      { trajectoryId, user },
      expect.any(AbortSignal),
    );
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

test.each([
  { label: "undefined", value: undefined, assignments: {} },
  { label: "null", value: null, assignments: {} },
  {
    label: "an explicit empty array",
    value: [],
    assignments: { learningContainerIds: [] },
  },
])(
  "a selector sends $label with the intended join semantics",
  async ({ value, assignments }) => {
    const upstream = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ trajectoryId, joinToken: "join-token" }),
      );
    const intelligence = new CopilotKitIntelligence({
      apiKey: "project-key",
      apiUrl: "https://intelligence.example",
      wsUrl: "wss://realtime.example",
      getTrajectoryLearningContainerIds: () => value,
    });
    try {
      await intelligence.ɵconnectTrajectory({ trajectoryId, user });

      expect(upstream).toHaveBeenCalledWith(
        "https://intelligence.example/api/trajectories/join",
        expect.objectContaining({
          body: JSON.stringify({
            trajectoryId,
            appUserId: user.id,
            ...assignments,
          }),
        }),
      );
    } finally {
      upstream.mockRestore();
    }
  },
);

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

test.each(["deadline", "request abort"] as const)(
  "a selector that ignores cancellation settles on %s without requesting a token",
  async (trigger) => {
    vi.useFakeTimers();
    const upstream = vi.spyOn(globalThis, "fetch");
    const logError = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);
    let finish: ((ids: string[]) => void) | undefined;
    const selector = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          finish = resolve;
        }),
    );
    const intelligence = new CopilotKitIntelligence({
      apiKey: "project-key",
      getTrajectoryLearningContainerIds: selector,
    });
    const controller = new AbortController();
    const settled = vi.fn();
    try {
      const pending = intelligence.ɵconnectTrajectory({
        trajectoryId,
        user,
        signal: controller.signal,
      });
      void pending.then(settled, settled);
      if (trigger === "deadline") await vi.advanceTimersByTimeAsync(5_000);
      else {
        controller.abort();
        await vi.advanceTimersByTimeAsync(0);
      }

      expect(settled).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining(
          trigger === "deadline"
            ? { code: "LEARNING_CONTAINER_SELECTION_FAILED", status: 500 }
            : { name: "AbortError" },
        ),
      );
      expect(selector).toHaveBeenCalledWith(
        { trajectoryId, user },
        expect.objectContaining({ aborted: true }),
      );
      expect(vi.getTimerCount()).toBe(0);
      finish?.(["late-space"]);
      await vi.advanceTimersByTimeAsync(0);
      expect(upstream).not.toHaveBeenCalled();
    } finally {
      upstream.mockRestore();
      logError.mockRestore();
      vi.useRealTimers();
    }
  },
);

test("a cancelled request skips selection and a completed selector preserves the upstream request signal", async () => {
  vi.useFakeTimers();
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      Response.json({ trajectoryId, joinToken: "join-token" }),
    );
  const selector = vi.fn(() => ["space-1"]);
  const intelligence = new CopilotKitIntelligence({
    apiKey: "project-key",
    getTrajectoryLearningContainerIds: selector,
  });
  const cancelled = new AbortController();
  cancelled.abort();
  const active = new AbortController();
  try {
    await expect(
      intelligence.ɵconnectTrajectory({
        trajectoryId,
        user,
        signal: cancelled.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(selector).not.toHaveBeenCalled();
    await intelligence.ɵconnectTrajectory({
      trajectoryId,
      user,
      signal: active.signal,
    });
    expect(upstream).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      expect.objectContaining({ signal: active.signal }),
    );
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    upstream.mockRestore();
    vi.useRealTimers();
  }
});
