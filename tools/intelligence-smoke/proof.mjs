import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { expectedCitationIds } from "./model.mjs";

const nonempty = (value) =>
  typeof value === "string" && value.trim().length > 0;
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const count = (value) => Number.isSafeInteger(value) && value >= 0;
function requireProof(condition, message) {
  if (!condition) throw new Error(message);
}
function polling(
  { request, now = Date.now, sleep = setTimeout, timeoutMs },
  label,
) {
  const deadline = now() + timeoutMs;
  const remaining = () => {
    const value = deadline - now();
    requireProof(value > 0, `${label} timed out.`);
    return value;
  };
  return {
    request: async (...args) => {
      let timer;
      try {
        const duration = remaining();
        const result = await Promise.race([
          request(...args),
          new Promise((_, reject) => {
            timer = globalThis.setTimeout(
              () => reject(new Error(`${label} timed out.`)),
              duration,
            );
          }),
        ]);
        remaining();
        return result;
      } finally {
        globalThis.clearTimeout(timer);
      }
    },
    wait: async () => {
      await sleep(Math.min(1000, remaining()));
    },
  };
}

/** request routes /agent/* to the runtime and /api/* to app-api; it rejects HTTP errors. */
export async function verifyThread({
  request,
  threadId,
  runId,
  userMessageId,
  prompt,
  expectedReply,
  timeoutMs = 90_000,
  now,
  sleep,
}) {
  requireProof(
    [threadId, runId, userMessageId, prompt, expectedReply].every(nonempty),
    "Thread proof requires nonempty IDs, prompt, and expected reply.",
  );
  const deadline = polling({ request, now, sleep, timeoutMs }, "Thread proof");
  request = deadline.request;
  const wait = deadline.wait;
  const accepted = await request("POST", "/agent/smoke/run", {
    context: [],
    forwardedProps: {},
    messages: [{ id: userMessageId, role: "user", content: prompt }],
    runId,
    state: {},
    threadId,
    tools: [],
  });
  requireProof(
    nonempty(accepted?.threadId) && nonempty(accepted?.runId),
    "Runtime did not accept the thread and run.",
  );
  threadId = accepted.threadId;
  runId = accepted.runId;
  for (;;) {
    const payload = await request(
      "GET",
      `/api/threads/${encodeURIComponent(threadId)}/messages`,
    );
    requireProof(
      Array.isArray(payload?.messages),
      "Invalid persisted thread messages.",
    );
    const messages = payload.messages;
    const userIndex = messages.findIndex(
      (message) =>
        message?.id === userMessageId &&
        message.role === "user" &&
        message.content === prompt,
    );
    const afterUser = messages.slice(userIndex + 1);
    if (
      userIndex >= 0 &&
      !afterUser.some((message) => message?.role === "user") &&
      afterUser.some(
        (message) =>
          message?.role === "assistant" && message.content === expectedReply,
      )
    ) {
      // Learning uses one-based positions in the frozen transcript, not AG-UI IDs.
      return {
        threadId,
        runId,
        messages,
        messageIds: messages.map(
          (_, index) => `${threadId}:message:${index + 1}`,
        ),
      };
    }
    await wait();
  }
}

/** Submit Learning through its public API, then independently read durable output twice. */
export async function verifyLearning({
  request,
  projectId,
  threadId,
  runId: sourceRunId,
  messageIds,
  containerId,
  timeoutMs = 900_000,
  now,
  sleep,
}) {
  requireProof(
    /^[1-9]\d*$/.test(String(projectId)) &&
      [threadId, containerId, sourceRunId].every(nonempty),
    "Invalid Learning proof scope.",
  );
  requireProof(
    Array.isArray(messageIds) &&
      messageIds.length > 0 &&
      messageIds.every((id) => nonempty(id)),
    "Learning proof requires saved message IDs.",
  );
  requireProof(
    messageIds.every((id, index) => id === `${threadId}:message:${index + 1}`),
    "Learning proof requires ordered saved message IDs.",
  );
  const positions = new Set(messageIds.map((_, index) => String(index + 1)));
  const base = `/api/learning/projects/${encodeURIComponent(projectId)}/containers`;
  const container = `${base}/${encodeURIComponent(containerId)}`;
  const deadline = polling(
    { request, now, sleep, timeoutMs },
    "Learning proof",
  );
  request = deadline.request;
  const wait = deadline.wait;
  const created = await request("POST", base, {
    id: containerId,
    name: "Local acceptance proof",
  });
  requireProof(
    created?.container?.id === containerId &&
      created.container.projectId === Number(projectId),
    "Invalid Learning Container response.",
  );
  const preview = await request(
    "POST",
    `${container}/thread-binding-operations`,
    { selection: { mode: "explicit", threadIds: [threadId] } },
  );
  requireProof(
    nonempty(preview?.operationId) &&
      preview.containerId === containerId &&
      preview.status === "preview" &&
      preview.preview?.selectedThreads === 1 &&
      preview.preview.conflictingThreads === 0 &&
      count(preview.preview.totalRuns) &&
      preview.preview.totalRuns > 0,
    "Invalid thread binding preview.",
  );
  const operation = `${container}/thread-binding-operations/${encodeURIComponent(preview.operationId)}`;
  let binding = await request("POST", `${operation}/commit`, {});
  for (;;) {
    requireProof(
      binding?.operationId === preview.operationId &&
        binding.containerId === containerId &&
        binding.status === "committed" &&
        binding.binding?.boundThreads === 1 &&
        binding.binding.conflictingThreads === 0 &&
        binding.binding.missingThreads === 0,
      "Invalid thread binding result.",
    );
    const progress = binding.progress;
    requireProof(
      progress &&
        count(progress.harvestedRuns) &&
        count(progress.pendingRuns) &&
        progress.unrecoverableRuns === 0 &&
        progress.skippedRuns === 0,
      "Invalid thread harvest result.",
    );
    if (progress.pendingRuns === 0 && progress.harvestedRuns > 0) break;
    await wait();
    binding = await request("GET", operation);
  }
  const readInsights = async () => {
    const response = await request("GET", `${container}/insights`);
    requireProof(
      Array.isArray(response?.insights),
      "Invalid stored Learning output.",
    );
    return response.insights;
  };
  requireProof(
    (await readInsights()).length === 0,
    "Proof requires a new Learning Container.",
  );
  const accepted = await request("POST", `${container}/runs`, {});
  let run = accepted?.run;
  const acceptedId = run?.id;
  const statuses = [
    "queued",
    "freezing",
    "batching",
    "reducing",
    "finalizing",
    "succeeded",
    "failed",
  ];
  for (;;) {
    requireProof(
      nonempty(run?.id) &&
        run.id === acceptedId &&
        run.learningContainerId === containerId &&
        run.projectId === Number(projectId) &&
        statuses.includes(run.status),
      "Invalid Learning run response.",
    );
    requireProof(run.status !== "failed", "Learning run failed.");
    if (run.status === "succeeded") break;
    await wait();
    const response = await request("GET", `${container}/runs`);
    requireProof(
      Array.isArray(response?.runs),
      "Invalid Learning runs response.",
    );
    run = response.runs.find((item) => item.id === acceptedId);
    requireProof(run, "Accepted Learning run disappeared.");
  }
  requireProof(
    count(run.evidenceThreadCount) &&
      run.evidenceThreadCount > 0 &&
      count(run.insightCount) &&
      run.insightCount > 0,
    "Learning requires nonempty output with transcript evidence.",
  );
  const first = await readInsights();
  requireProof(
    first.length === run.insightCount &&
      new Set(first.map((insight) => insight.id)).size === first.length,
    "Stored Learning output count is invalid.",
  );
  const snapshotIds = new Set();
  for (const insight of first) {
    requireProof(
      nonempty(insight?.id) &&
        insight.runId === run.id &&
        nonempty(insight.statement) &&
        nonempty(insight.impact),
      "Stored Learning output is empty or belongs to another run.",
    );
    requireProof(
      Array.isArray(insight.evidence) &&
        insight.evidence.length > 0 &&
        insight.evidence.every(
          (reference) =>
            reference?.threadId === threadId &&
            reference.sourceRunId === sourceRunId &&
            uuid(reference.snapshotId) &&
            Array.isArray(reference.messageIds) &&
            JSON.stringify(reference.messageIds) ===
              JSON.stringify(expectedCitationIds(reference.snapshotId)) &&
            reference.messageIds.every(
              (id) =>
                typeof id === "string" &&
                id.startsWith(`${reference.snapshotId}:message:`) &&
                positions.has(
                  id.slice(`${reference.snapshotId}:message:`.length),
                ),
            ),
        ),
      "Stored Learning output has missing or unrelated evidence.",
    );
    for (const reference of insight.evidence)
      snapshotIds.add(reference.snapshotId);
  }
  requireProof(
    snapshotIds.size === 1,
    "Stored Learning output has conflicting snapshot evidence.",
  );
  // Normalize row and object-key order; retain every stored field in the digest.
  const digest = (rows) =>
    createHash("sha256")
      .update(
        JSON.stringify(
          canonical(
            [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id))),
          ),
        ),
      )
      .digest("hex");
  const storedOutputSha256 = digest(first);
  requireProof(
    digest(await readInsights()) === storedOutputSha256,
    "Stored Learning output changed between reads.",
  );
  return {
    threadId,
    containerId,
    sourceRunId,
    snapshotId: [...snapshotIds][0],
    runId: run.id,
    insightIds: first.map((insight) => insight.id),
    storedOutputRead: true,
    storedOutputSha256,
  };
}
