import assert from "node:assert/strict";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { durableJson, recoveryLock } from "./journal.mjs";

export const inspectionLimit = 8 * 1024 * 1024;
const hash = (token) => createHash("sha256").update(token).digest("hex");
function directory({ controlDirectory, runId }) {
  assert.match(runId, /^[a-z][a-z0-9-]{0,62}$/);
  return join(controlDirectory, runId, "inspection");
}
async function read(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
async function readState(path) {
  const state = await read(path);
  const journal = await read(join(dirname(dirname(path)), "journal.json"));
  assert.equal(journal.runId, state.runId, "Inspection journal run mismatch");
  assert.equal(
    journal.projectId,
    state.projectId,
    "Inspection journal project mismatch",
  );
  assert.equal(
    journal.environmentId,
    state.environmentId,
    "Inspection journal environment mismatch",
  );
  assert.equal(
    journal.expiresAt,
    state.expiresAt,
    "Inspection journal deadline mismatch",
  );
  if (!["setup", "ready"].includes(journal.phase)) state.active = false;
  return state;
}
async function exclusive(path, action) {
  const deadline = Date.now() + 6000;
  let release;
  while (!release) {
    try {
      release = await recoveryLock(path + ".lock");
    } catch (error) {
      if (
        !(
          String(error.message).includes("still alive") ||
          error.code === "ENOENT"
        ) ||
        Date.now() >= deadline
      )
        throw error;
      await delay(10);
    }
  }
  try {
    return await action();
  } finally {
    await release();
  }
}
/** Only fixed observations and canonical bootstrap cross the channel. */
export function validateInspectionOperation(operation, input = {}) {
  assert.ok(
    input && typeof input === "object" && !Array.isArray(input),
    "Invalid inspection input",
  );
  const keys = Object.keys(input).sort().join(",");
  if (operation === "readiness")
    assert.ok(
      keys === "target" &&
        ["database", "cache", "worker"].includes(input.target),
      "Invalid readiness input",
    );
  else if (
    ["bootstrap", "database-snapshot", "redis-snapshot"].includes(operation)
  )
    assert.equal(keys, "", "Invalid inspection input");
  else if (operation === "native-snapshot")
    assert.ok(
      keys === "framework" &&
        ["mastra", "strands-typescript"].includes(input.framework),
      "Invalid native input",
    );
  else if (["thread-metadata", "thread-events"].includes(operation))
    assert.ok(
      keys === "framework,threadId" &&
        ["mastra", "strands-typescript"].includes(input.framework) &&
        typeof input.threadId === "string" &&
        input.threadId.length > 0 &&
        input.threadId.length <= 256,
      "Invalid thread input",
    );
  else throw new Error("Unsupported inspection operation");
}
/** Store only a credential hash in the permanent private authority. */
export async function initializeInspection(context) {
  assert.match(context.token, /^[a-f0-9]{64}$/);
  assert.ok(Date.parse(context.expiresAt) > Date.now());
  const dir = directory(context);
  const journal = await read(join(dirname(dir), "journal.json"));
  assert.equal(journal.runId, context.runId);
  assert.equal(journal.expiresAt, context.expiresAt);
  assert.ok(
    journal.projectId && journal.environmentId && journal.phase === "setup",
    "Owned active inspection journal required",
  );
  await mkdir(dir, { mode: 0o700 });
  await durableJson(join(dir, "state.json"), {
    runId: context.runId,
    projectId: journal.projectId,
    environmentId: journal.environmentId,
    tokenHash: hash(context.token),
    expiresAt: context.expiresAt,
    active: true,
  });
}
/** Revocation precedes provider teardown and survives controller restarts. */
export async function closeInspection(context) {
  const path = join(directory(context), "state.json");
  await exclusive(path, async () => {
    const state = await read(path);
    state.active = false;
    await durableJson(path, state);
  });
}
function active(state) {
  assert.ok(
    state.active && Date.now() < Date.parse(state.expiresAt),
    "Inspection attempt inactive or expired",
  );
}
/** Queue one bounded operation; lost workers and uncertain execution never pass. */
export async function requestInspection(context) {
  const { operation, input = {}, timeoutMs = 35000 } = context;
  validateInspectionOperation(operation, input);
  const dir = directory(context),
    state = await readState(join(dir, "state.json"));
  active(state);
  const lock = join(dir, "request-lock");
  await mkdir(lock, { mode: 0o700 });
  try {
    const requestId = randomUUID(),
      deadline = Math.min(Date.now() + timeoutMs, Date.parse(state.expiresAt));
    const path = join(dir, "request.json");
    // Controller calls serialize; refuse overlapping or abandoned work explicitly.
    try {
      const prior = await read(path);
      assert.ok(prior.completed, "Inspection operation already pending");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await durableJson(path, {
      runId: context.runId,
      requestId,
      operation,
      input,
      deadline,
      claimed: false,
      completed: false,
    });
    while (Date.now() < deadline) {
      const current = await exclusive(join(dir, "state.json"), async () => {
        active(await readState(join(dir, "state.json")));
        const queued = await read(path);
        assert.equal(
          queued.requestId,
          requestId,
          "Inspection request replaced",
        );
        return queued;
      });
      if (current.completed) {
        assert.ok(current.ok, "Private inspection operation failed");
        return current.result;
      }
      await delay(Math.min(25, Math.max(1, deadline - Date.now())));
    }
    throw new Error("Private inspection worker timed out");
  } finally {
    await rm(lock, { recursive: true });
  }
}
/** Bound request and response bodies before JSON parsing. */
export async function boundedJson(stream, limit = inspectionLimit) {
  let size = 0;
  const chunks = [];
  const timer = setTimeout(
    () => stream.destroy?.(new Error("Inspection body timeout")),
    5000,
  );
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      assert.ok(size <= limit, "Inspection payload too large");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    clearTimeout(timer);
  }
}
/** Separate worker authentication; no admin-token fallback and no job submission route. */
export function inspectionHandler({ controlDirectory }) {
  return async (request, response) => {
    const send = (code, value) => {
      response.writeHead(code, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(value));
    };
    const match = new URL(request.url, "http://runner").pathname.match(
      /^\/inspection\/([a-z][a-z0-9-]{0,62})\/(poll|result)$/,
    );
    if (!match) return send(404, { error: "not-found" });
    const [, runId, route] = match,
      dir = directory({ controlDirectory, runId }),
      statePath = join(dir, "state.json");
    try {
      await exclusive(statePath, async () => {
        const state = await readState(statePath);
        const actual = hash(
          (request.headers.authorization ?? "").replace(/^Bearer /, ""),
        );
        if (
          !state.active ||
          Date.now() >= Date.parse(state.expiresAt) ||
          !timingSafeEqual(Buffer.from(actual), Buffer.from(state.tokenHash))
        )
          return send(401, { error: "unauthorized" });
        const path = join(dir, "request.json");
        let job;
        try {
          job = await read(path);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        if (route === "poll" && request.method === "GET") {
          if (
            !job ||
            job.completed ||
            job.claimed ||
            Date.now() >= job.deadline
          )
            return send(200, { pending: false });
          job.claimed = true;
          await durableJson(path, job);
          return send(200, {
            runId,
            requestId: job.requestId,
            operation: job.operation,
            input: job.input,
            deadline: job.deadline,
          });
        }
        if (route === "result" && request.method === "POST") {
          const body = await boundedJson(request);
          assert.ok(
            job &&
              job.claimed &&
              !job.completed &&
              Date.now() < job.deadline &&
              body.runId === runId &&
              body.requestId === job.requestId &&
              typeof body.ok === "boolean",
            "Invalid inspection result",
          );
          assert.ok(
            Object.keys(body).every((k) =>
              ["runId", "requestId", "ok", "result"].includes(k),
            ),
            "Invalid result fields",
          );
          active(await readState(statePath));
          assert.ok(Date.now() < job.deadline, "Result expired");
          await durableJson(path, {
            ...job,
            completed: true,
            ok: body.ok,
            ...(body.ok ? { result: body.result } : {}),
          });
          return send(200, { accepted: true });
        }
        send(404, { error: "not-found" });
      });
    } catch {
      if (!response.headersSent) send(409, { error: "inspection-refused" });
      else response.destroy();
    }
  };
}
