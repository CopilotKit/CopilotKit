import { expect, test, vi } from "vitest";
import { logger } from "@copilotkit/shared";
import { CopilotKitIntelligence } from "../client";

const trajectoryId = "550e8400-e29b-41d4-a716-446655440000";
const user = { id: "verified-user", name: "Verified User" };

/** Builds a two-slot array whose first slot is a hole. */
function sparseIds(): string[] {
  const ids: string[] = [];
  ids[1] = "space-a";
  return ids;
}

/** Builds an Intelligence error response in the REST error contract. */
function errorResponse(code: string, status: number): Response {
  return Response.json({ error: { code, message: code } }, { status });
}

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

test.each([
  { label: "an invalid ID", value: ["invalid container"] },
  { label: "a sparse array", value: sparseIds() },
  { label: "a non-array result", value: "space-a" as unknown as string[] },
  {
    label: "over 100 IDs",
    value: Array.from({ length: 101 }, (_, index) => `space-${index}`),
  },
])(
  "a selector returning $label connects the Trajectory without assignments and logs the error",
  async ({ value }) => {
    const upstream = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ trajectoryId, joinToken: "join-token" }),
      );
    const logError = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);
    const intelligence = new CopilotKitIntelligence({
      apiKey: "project-key",
      apiUrl: "https://intelligence.example",
      wsUrl: "wss://realtime.example",
      getTrajectoryLearningContainerIds: () => value,
    });
    try {
      await expect(
        intelligence.ɵconnectTrajectory({ trajectoryId, user }),
      ).resolves.toMatchObject({ joinToken: "join-token" });

      expect(upstream).toHaveBeenCalledExactlyOnceWith(
        "https://intelligence.example/api/trajectories/join",
        expect.objectContaining({
          body: JSON.stringify({ trajectoryId, appUserId: user.id }),
        }),
      );
      expect(logError).toHaveBeenCalledWith(
        { err: expect.any(Error), trajectoryId },
        "Failed to resolve Trajectory Learning Containers; connecting the Trajectory without Learning Container assignments",
      );
    } finally {
      upstream.mockRestore();
      logError.mockRestore();
    }
  },
);

test("a selector that ignores cancellation connects without assignments after the deadline", async () => {
  vi.useFakeTimers();
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      Response.json({ trajectoryId, joinToken: "join-token" }),
    );
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
  const settled = vi.fn();
  try {
    void intelligence
      .ɵconnectTrajectory({ trajectoryId, user })
      .then(settled, settled);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(settled).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ joinToken: "join-token" }),
    );
    expect(selector).toHaveBeenCalledWith(
      { trajectoryId, user },
      expect.objectContaining({ aborted: true }),
    );
    expect(upstream).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ trajectoryId, appUserId: user.id }),
      }),
    );
    expect(logError).toHaveBeenCalledWith(
      { err: expect.any(Error), trajectoryId },
      "Failed to resolve Trajectory Learning Containers; connecting the Trajectory without Learning Container assignments",
    );
    expect(vi.getTimerCount()).toBe(0);
    finish?.(["late-space"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(upstream).toHaveBeenCalledTimes(1);
  } finally {
    upstream.mockRestore();
    logError.mockRestore();
    vi.useRealTimers();
  }
});

test("a request abort during selection stops without requesting a token", async () => {
  vi.useFakeTimers();
  const upstream = vi.spyOn(globalThis, "fetch");
  const logError = vi
    .spyOn(logger, "error")
    .mockImplementation(() => undefined);
  const selector = vi.fn(() => new Promise<string[]>(() => undefined));
  const intelligence = new CopilotKitIntelligence({
    apiKey: "project-key",
    getTrajectoryLearningContainerIds: selector,
  });
  const controller = new AbortController();
  const settled = vi.fn();
  try {
    void intelligence
      .ɵconnectTrajectory({ trajectoryId, user, signal: controller.signal })
      .then(settled, settled);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect(settled).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: "AbortError" }),
    );
    expect(selector).toHaveBeenCalledWith(
      { trajectoryId, user },
      expect.objectContaining({ aborted: true }),
    );
    expect(vi.getTimerCount()).toBe(0);
    expect(upstream).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  } finally {
    upstream.mockRestore();
    logError.mockRestore();
    vi.useRealTimers();
  }
});

test("an unknown Learning Space retries the join once without assignments and logs the selected IDs", async () => {
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "LEARNING_CONTAINER_NOT_FOUND",
            message: "Learning Container not found",
          },
        },
        { status: 404 },
      ),
    )
    .mockResolvedValueOnce(
      Response.json({ trajectoryId, joinToken: "join-token" }),
    );
  const logWarn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  const intelligence = new CopilotKitIntelligence({
    apiKey: "project-key",
    apiUrl: "https://intelligence.example",
    wsUrl: "wss://realtime.example",
    getTrajectoryLearningContainerIds: () => ["expense-review", "typo-space"],
  });
  try {
    await expect(
      intelligence.ɵconnectTrajectory({ trajectoryId, user }),
    ).resolves.toMatchObject({ joinToken: "join-token" });

    expect(upstream).toHaveBeenCalledTimes(2);
    expect(upstream.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({
        trajectoryId,
        appUserId: user.id,
        learningContainerIds: ["expense-review", "typo-space"],
      }),
    });
    expect(upstream.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ trajectoryId, appUserId: user.id }),
    });
    expect(logWarn).toHaveBeenCalledWith(
      {
        trajectoryId,
        learningContainerIds: ["expense-review", "typo-space"],
      },
      "A selected Learning Container does not exist in this project; connecting the Trajectory without Learning Container assignments",
    );
  } finally {
    upstream.mockRestore();
    logWarn.mockRestore();
  }
});

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

test.each([
  { code: "TRAJECTORY_APP_USER_CONFLICT", status: 409 },
  { code: "VALIDATION_ERROR", status: 400 },
])(
  "a $code join error with assignments is not retried and keeps its code",
  async ({ code, status }) => {
    const upstream = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(errorResponse(code, status));
    const intelligence = new CopilotKitIntelligence({
      apiKey: "project-key",
      getTrajectoryLearningContainerIds: () => ["space-a"],
    });
    try {
      await expect(
        intelligence.ɵconnectTrajectory({ trajectoryId, user }),
      ).rejects.toMatchObject({ code, status });
      expect(upstream).toHaveBeenCalledTimes(1);
    } finally {
      upstream.mockRestore();
    }
  },
);

test("a failed retry without assignments surfaces its own error and is not retried again", async () => {
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(errorResponse("LEARNING_CONTAINER_NOT_FOUND", 404))
    .mockResolvedValueOnce(errorResponse("TRAJECTORY_APP_USER_CONFLICT", 409));
  const logWarn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  const intelligence = new CopilotKitIntelligence({
    apiKey: "project-key",
    getTrajectoryLearningContainerIds: () => ["typo-space"],
  });
  try {
    await expect(
      intelligence.ɵconnectTrajectory({ trajectoryId, user }),
    ).rejects.toMatchObject({
      code: "TRAJECTORY_APP_USER_CONFLICT",
      status: 409,
    });
    expect(upstream).toHaveBeenCalledTimes(2);
  } finally {
    upstream.mockRestore();
    logWarn.mockRestore();
  }
});

test("a request aborted after an unknown Learning Space stops without a retry or a warning", async () => {
  const controller = new AbortController();
  const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    controller.abort();
    return Promise.resolve(errorResponse("LEARNING_CONTAINER_NOT_FOUND", 404));
  });
  const logWarn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  const intelligence = new CopilotKitIntelligence({
    apiKey: "project-key",
    getTrajectoryLearningContainerIds: () => ["typo-space"],
  });
  try {
    await expect(
      intelligence.ɵconnectTrajectory({
        trajectoryId,
        user,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(logWarn).not.toHaveBeenCalled();
  } finally {
    upstream.mockRestore();
    logWarn.mockRestore();
  }
});
