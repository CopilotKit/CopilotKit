import assert from "node:assert/strict";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { inspectNativeDirectory } from "../clean-scope.mjs";
import { boundedJson, inspectionLimit } from "./inspection-channel.mjs";

/** Private, credential-bound scanner; request data cannot choose paths or SQL. */
export function nativeInspectionServer(config) {
  assert.match(config.runId, /^[a-z][a-z0-9-]{0,62}$/);
  assert.ok(
    Number.isFinite(Date.parse(config.expiresAt)) &&
      Date.parse(config.expiresAt) > Date.now(),
    "Native inspection expiry required",
  );
  assert.match(config.token, /^[a-f0-9]{64}$/);
  const expected = Buffer.from(`Bearer ${config.token}`),
    seen = new Set();
  return createServer(async (req, res) => {
    const send = (code, value) => {
      res.writeHead(code, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const auth = Buffer.from(req.headers.authorization ?? "");
      if (
        Date.now() >= Date.parse(config.expiresAt) ||
        auth.length !== expected.length ||
        !timingSafeEqual(auth, expected)
      )
        return send(401, { error: "unauthorized" });
      assert.ok(req.method === "POST" && req.url === "/inspect");
      const body = await boundedJson(req, 1024);
      assert.ok(
        Object.keys(body).sort().join(",") === "requestId,runId" &&
          body.runId === config.runId &&
          /^[a-f0-9-]{36}$/.test(body.requestId) &&
          !seen.has(body.requestId),
      );
      assert.ok(
        Date.now() < Date.parse(config.expiresAt),
        "Native inspection expired",
      );
      assert.ok(seen.size < 10000, "Native request bound exceeded");
      seen.add(body.requestId);
      const report = await inspectNativeDirectory(
        config.root,
        config.bootstrapTables,
      );
      const result = { runId: body.runId, requestId: body.requestId, report };
      assert.ok(Buffer.byteLength(JSON.stringify(result)) <= inspectionLimit);
      send(200, result);
    } catch {
      send(409, { error: "native-inspection-failed" });
    }
  });
}
