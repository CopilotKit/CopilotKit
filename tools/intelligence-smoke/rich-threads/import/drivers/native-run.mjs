import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Decode the real native AG-UI transport without consulting imported history. */
export async function readNativeEvents(response, onEvent) {
  assert.equal(
    response.status,
    200,
    `Native endpoint returned ${response.status}`,
  );
  assert.match(
    response.headers.get("content-type") ?? "",
    /text\/event-stream/i,
  );
  assert.ok(response.body, "Native endpoint has no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let data = [];
  const line = (value) => {
    if (value === "") {
      if (data.length) {
        const payload = data.join("\n");
        data = [];
        if (payload !== "[DONE]") {
          const event = JSON.parse(payload);
          assert.equal(
            typeof event.type,
            "string",
            "Native event needs a type",
          );
          onEvent(event);
        }
      }
    } else if (value.startsWith("data:")) {
      data.push(value.slice(5).replace(/^ /, ""));
    }
  };
  const drain = (final = false) => {
    let end;
    while ((end = buffer.search(/[\r\n]/)) !== -1) {
      // A CRLF pair may straddle transport chunks.
      if (!final && buffer[end] === "\r" && end === buffer.length - 1) break;
      line(buffer.slice(0, end));
      const length = buffer[end] === "\r" && buffer[end + 1] === "\n" ? 2 : 1;
      buffer = buffer.slice(end + length);
    }
    if (final) {
      // SSE dispatch requires a blank line. An interrupted frame isn't evidence.
      assert.equal(buffer, "", "Truncated native SSE line");
      assert.equal(data.length, 0, "Truncated native SSE event");
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      drain();
    }
    buffer += decoder.decode();
    drain(true);
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export function verifyNativeRun(input, events) {
  const starts = events.filter((event) => event.type === "RUN_STARTED");
  const finishes = events.filter((event) => event.type === "RUN_FINISHED");
  assert.equal(starts.length, 1, "Expected one native run start");
  assert.equal(
    finishes.length,
    1,
    "Native run did not finish or pause cleanly",
  );
  for (const event of [...starts, ...finishes]) {
    assert.equal(
      event.threadId,
      input.threadId,
      "Native thread identity changed",
    );
    assert.equal(event.runId, input.runId, "Native run identity changed");
  }
  assert.deepEqual(
    events.filter((event) => event.type === "RUN_ERROR"),
    [],
    "Native run failed",
  );
  return finishes[0];
}

/** The common lifecycle owns these direct native endpoints and durable stores.
 * This bypasses Intelligence, preserves original requests/events/checkpoints and
 * invokes the actual Showcase agent with its registered frontend tool catalogue.
 * Native-SDK-only histories are supplied separately by native-sources.mjs.
 */
export async function captureNativeRun({
  framework,
  scope,
  route,
  input,
  outputDir,
  signal,
}) {
  assert.ok(
    scope.owner && scope.native?.location,
    "Owned durable native scope required",
  );
  assert.match(input.threadId, /^[a-zA-Z0-9_-]+$/);
  assert.match(input.runId, /^[a-zA-Z0-9_-]+$/);
  assert.ok(
    input.runId && Array.isArray(input.messages) && input.messages.length,
  );
  const endpoint = scope.native.endpoints?.[route];
  if (!endpoint)
    throw Object.assign(
      new Error(
        `Missing direct Showcase native endpoint: ${framework}/${route}`,
      ),
      { code: "RICH_IMPORT_SETUP" },
    );
  const url = new URL(endpoint);
  assert.ok(
    ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password,
  );
  for (const forbidden of [scope.apiUrl, scope.gatewayUrl, scope.runtimeUrl])
    if (forbidden)
      assert.notEqual(
        url.href,
        new URL(forbidden).href,
        "Source must bypass Intelligence/runtime history",
      );
  const { createNativeReader } = await import("../../row2/showcase-store.mjs");
  const read = createNativeReader(framework, scope.native);
  const identity = {
    threadId: input.threadId,
    resourceId: scope.native.resourceId,
    runIds: [input.runId],
  };
  const record = {
    owner: scope.owner,
    framework,
    endpoint: url.href,
    input: structuredClone(input),
    events: [],
    provenance: "Real Showcase native AG-UI run; not an SDK-only history",
  };
  await mkdir(outputDir, { recursive: true });
  try {
    record.before = await read(identity);
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(input),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
        : AbortSignal.timeout(120_000),
    });
    await readNativeEvents(response, (event) => record.events.push(event));
    record.terminal = verifyNativeRun(input, record.events);
    record.after = await read(identity);
    return record;
  } catch (error) {
    record.error = { message: error.message, code: error.code };
    throw error;
  } finally {
    await writeFile(
      join(outputDir, `${input.runId}-native-run.json`),
      JSON.stringify(record, null, 2),
      { mode: 0o600 },
    );
  }
}
