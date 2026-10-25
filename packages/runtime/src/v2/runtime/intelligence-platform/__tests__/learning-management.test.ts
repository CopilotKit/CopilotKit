import { expect, test, vi } from "vitest";
import { CopilotKitIntelligence } from "../client";

const container = {
  id: "coding",
  name: "Coding",
  projectId: 7,
  promptContext: null,
  createdAt: "2026-10-24T12:00:00.000Z",
  updatedAt: "2026-10-24T12:00:00.000Z",
};

/** Creates an isolated client and restores the process fetch implementation. */
function setup() {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const client = new CopilotKitIntelligence({
    apiKey: "cpk-test",
    apiUrl: "http://127.0.0.1:3000",
    wsUrl: "ws://127.0.0.1:3001",
  });
  return { client, fetchMock, teardown: () => fetchMock.mockRestore() };
}

test("lists Learning spaces with a cursor and resolves one named space", async () => {
  const { client, fetchMock, teardown } = setup();
  try {
    fetchMock.mockResolvedValueOnce(
      Response.json({ containers: [container], nextCursor: "next" }),
    );
    expect(
      await client.listLearningContainers({ cursor: "date|coding" }),
    ).toEqual({ containers: [container], nextCursor: "next" });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://127.0.0.1:3000/api/v1/learning/containers?cursor=date%7Ccoding",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer cpk-test" }),
      }),
    );
    fetchMock.mockResolvedValueOnce(Response.json({ container }));
    expect(
      await client.getLearningContainer({ containerId: "coding" }),
    ).toEqual(container);
  } finally {
    teardown();
  }
});

const id = "0198a012-a20f-77c0-9e33-8992f18e74a1";
const run = {
  id,
  learningContainerId: "coding",
  projectId: 7,
  status: "queued",
  triggerSource: "manual",
  attemptCount: 0,
  candidateCount: null,
  completedAt: null,
  createdAt: container.createdAt,
  failureCode: null,
  insightCount: null,
  kubernetesJobName: null,
  startedAt: null,
  updatedAt: container.updatedAt,
};
const candidate = {
  id,
  bundleSha256: "a".repeat(64),
  createdAt: container.createdAt,
  description: "Run the tests",
  operation: "add",
  publishedRegistryRevision: null,
  publishedSkillId: null,
  reason: "Repeated useful behavior",
  registryBaseRevision: 0,
  reviewedAt: null,
  runId: id,
  status: "pending_review",
  subjectSha256: "b".repeat(64),
  targetSkillId: null,
  targetSkillRevision: null,
  title: "Test workflow",
};

test("starts Learning once and returns run progress without retrying writes", async () => {
  const { client, fetchMock, teardown } = setup();
  try {
    fetchMock.mockResolvedValueOnce(Response.json({ run }, { status: 202 }));
    expect(await client.startLearningRun({ containerId: "coding" })).toEqual(
      run,
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://127.0.0.1:3000/api/v1/learning/containers/coding/runs",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
    fetchMock.mockResolvedValueOnce(Response.json({ runs: [run] }));
    expect(await client.listLearningRuns({ containerId: "coding" })).toEqual([
      run,
    ]);
    fetchMock.mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "LEARNING_NOT_ENABLED",
            retryable: false,
            message: "private details",
          },
        },
        { status: 403 },
      ),
    );
    await expect(
      client.startLearningRun({ containerId: "coding" }),
    ).rejects.toMatchObject({
      status: 403,
      retryable: false,
      code: "LEARNING_NOT_ENABLED",
      message: "Learning request failed (403).",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  } finally {
    teardown();
  }
});

test("reads proposed Skill content and evidence before an explicit review decision", async () => {
  const { client, fetchMock, teardown } = setup();
  const detail = {
    ...candidate,
    bundle: {
      schemaVersion: 1,
      files: [{ path: "SKILL.md", content: "# Tests", sha256: "c".repeat(64) }],
    },
    supportingInsights: [
      {
        id,
        alias: "test-first",
        impact: "Fewer regressions",
        statement: "Run tests first",
      },
    ],
  };
  const evidence = [
    {
      cited: [{ id: "message-1", content: "Run tests first", role: "user" }],
      messageCount: 1,
      threadId: "thread-1",
      threadName: "Fix greeting",
      threadPresent: true,
      unavailable: null,
    },
  ];
  const review = {
    candidateId: id,
    operation: "add",
    publishedRegistryRevision: 1,
    publishedSkillId: id,
    status: "approved",
  };
  try {
    fetchMock.mockResolvedValueOnce(Response.json({ candidates: [candidate] }));
    expect(
      await client.listLearningCandidates({ containerId: "coding" }),
    ).toEqual([candidate]);
    fetchMock.mockResolvedValueOnce(Response.json({ candidate: detail }));
    expect(
      await client.getLearningCandidate({
        containerId: "coding",
        candidateId: id,
      }),
    ).toEqual(detail);
    fetchMock.mockResolvedValueOnce(Response.json({ evidence }));
    expect(
      await client.getLearningInsightEvidence({
        containerId: "coding",
        insightId: id,
      }),
    ).toEqual(evidence);
    fetchMock.mockResolvedValueOnce(Response.json({ review }));
    expect(
      await client.reviewLearningCandidate({
        containerId: "coding",
        candidateId: id,
        action: "approve",
      }),
    ).toEqual(review);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `http://127.0.0.1:3000/api/v1/learning/containers/coding/candidates/${id}/approve`,
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  } finally {
    teardown();
  }
});

test("rejects invalid paths and malformed response data without returning a partial result", async () => {
  const { client, fetchMock, teardown } = setup();
  try {
    await expect(
      client.getLearningContainer({ containerId: "../private" }),
    ).rejects.toThrow();
    await expect(
      client.getLearningCandidate({
        containerId: "coding",
        candidateId: "../private",
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(
      Response.json({ containers: [{ id: "coding" }], nextCursor: null }),
    );
    await expect(client.listLearningContainers()).rejects.toMatchObject({
      status: 502,
      retryable: true,
      message: "Invalid Learning response.",
    });
    fetchMock.mockResolvedValueOnce(
      new Response("<private proxy error>", { status: 503 }),
    );
    await expect(client.listLearningContainers()).rejects.toMatchObject({
      status: 503,
      retryable: true,
      message: "Learning request failed (503).",
    });
  } finally {
    teardown();
  }
});

test("honors caller cancellation before fetching and while reading the response body", async () => {
  const { client, fetchMock, teardown } = setup();
  const controller = new AbortController();
  const cancel = vi.fn();
  try {
    const already = new AbortController();
    already.abort(new Error("Caller stopped"));
    await expect(
      client.listLearningContainers({ signal: already.signal }),
    ).rejects.toThrow("Caller stopped");
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode("{"));
          },
          cancel,
        }),
      ),
    );
    const result = client.listLearningContainers({ signal: controller.signal });
    await Promise.resolve();
    controller.abort(new Error("Caller stopped"));
    await expect(result).rejects.toThrow("Caller stopped");
    expect(cancel).toHaveBeenCalled();
  } finally {
    teardown();
  }
}, 1000);

test("bounds a stalled response body with the request deadline", async () => {
  const { client, fetchMock, teardown } = setup();
  vi.useFakeTimers();
  const cancel = vi.fn();
  try {
    fetchMock.mockResolvedValueOnce(
      new Response(new ReadableStream({ cancel })),
    );
    const result = client.listLearningContainers();
    const assertion = expect(result).rejects.toThrow(
      "Learning request timed out",
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
    teardown();
  }
});

test("preserves typed Learning memberships when reading an existing conversation", async () => {
  const { client, fetchMock, teardown } = setup();
  try {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        thread: {
          id: "thread-1",
          name: "Existing work",
          learningContainerId: "original-space",
          learningContainerIds: ["original-space"],
        },
      }),
    );
    const thread = await client.getThread({
      threadId: "thread-1",
      userId: "local-developer",
    });
    const assignment: string | null | undefined = thread.learningContainerId;
    const memberships: string[] | undefined = thread.learningContainerIds;
    expect(assignment).toBe("original-space");
    expect(memberships).toEqual(["original-space"]);
  } finally {
    teardown();
  }
});
