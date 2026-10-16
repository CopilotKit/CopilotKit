import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import { readCapture } from "./runtime-agent.mjs";

/** Authenticated original capture export from the owned runtime, never DB data. */
export function captureHandler({ directory, token }) {
  if (token !== undefined)
    assert.ok(
      typeof token === "string" && token.length >= 32,
      "Capture token must contain at least 32 characters",
    );
  return (req, res) => {
    if (!req.url?.startsWith("/rich-thread-capture/")) return false;
    const supplied = Buffer.from(req.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (
      !token ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      res.writeHead(401, { "cache-control": "no-store" }).end();
      return true;
    }
    const threadId = req.url.slice("/rich-thread-capture/".length);
    if (req.method !== "GET" || !/^[a-zA-Z0-9_-]{1,256}$/.test(threadId)) {
      res.writeHead(400).end();
      return true;
    }
    try {
      const payload = JSON.stringify(readCapture(directory, threadId));
      res
        .writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        })
        .end(payload);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
    return true;
  };
}

export function createCapture({ scope, provider, signal, fetchImpl = fetch }) {
  if (provider === "docker") {
    assert.ok(scope.capture?.directory, "Owned capture directory required");
    return {
      read: async (threadId) => readCapture(scope.capture.directory, threadId),
    };
  }
  assert.equal(provider, "railway", "Unsupported capture provider");
  const url = new URL(scope.capture?.url);
  assert.ok(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    "Railway capture requires a private-token HTTPS endpoint",
  );
  assert.ok(
    typeof scope.capture.token === "string" && scope.capture.token.length >= 32,
    "Private runtime capture token required",
  );
  return {
    read: async (threadId) => {
      assert.match(threadId, /^[a-zA-Z0-9_-]{1,256}$/);
      const endpoint = new URL(url);
      endpoint.pathname = `${url.pathname.replace(/\/$/, "")}/${threadId}`;
      let response;
      try {
        response = await fetchImpl(endpoint, {
          headers: { authorization: `Bearer ${scope.capture.token}` },
          redirect: "error",
          signal: AbortSignal.any([
            AbortSignal.timeout(15_000),
            ...(signal ? [signal] : []),
          ]),
        });
      } catch {
        throw new Error("Owned runtime capture request failed or timed out");
      }
      assert.equal(
        response.status,
        200,
        "Owned runtime capture endpoint rejected the request",
      );
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("Invalid original capture response JSON");
      }
      for (const field of ["events", "attempts", "frameworkRuns"])
        assert.ok(
          Array.isArray(data[field]),
          `Invalid source capture: ${field}`,
        );
      return data;
    },
  };
}
