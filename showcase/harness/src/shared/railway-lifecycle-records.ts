import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseRunRecordsSnapshot } from "./railway-lifecycle.js";
import type {
  LifecycleEvidence,
  RailwayLifecyclePolicy,
} from "./railway-lifecycle.js";

/**
 * Read one operator-configured atomic snapshot. The configured path is the trust
 * boundary: only the lifecycle writer/operator may publish it. Never infer an
 * empty snapshot from a configured read failure or expose file contents in errors.
 * An optional signal cancels the file read; cancellation errors propagate to callers.
 */
export async function readRailwayLifecycleEvidence(
  filePath: string | undefined,
  policy: RailwayLifecyclePolicy,
  now: Date,
  signal?: AbortSignal,
): Promise<LifecycleEvidence> {
  if (filePath === undefined) return { status: "unavailable" };
  signal?.throwIfAborted();
  let contents: string;
  let endpoint: URL | undefined;
  try {
    if (filePath.startsWith("https://")) {
      endpoint = new URL(filePath);
      if (
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash ||
        endpoint.pathname !== "/registry"
      )
        throw new Error("Invalid registry endpoint");
      const token = process.env.SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN;
      if (!token) throw new Error("Registry authentication missing");
      const response = await fetch(endpoint, {
        headers: { authorization: `Bearer ${token}` },
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
          : AbortSignal.timeout(10_000),
      });
      if (!response.ok || !response.body)
        throw new Error("Registry unavailable");
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 8 * 1024 * 1024) throw new Error("Registry exceeds bound");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      contents = Buffer.concat(chunks).toString("utf8");
      if (
        response.headers.get("x-snapshot-sha256") !==
          createHash("sha256").update(contents).digest("hex") ||
        response.headers.get("x-policy-sha256") !==
          createHash("sha256").update(JSON.stringify(policy)).digest("hex")
      )
        throw new Error("Registry policy or bytes differ");
    } else {
      contents = await readFile(filePath, { encoding: "utf8", signal });
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return {
      status: "invalid",
      issues: [
        {
          code: "records-unreadable",
          message: "Configured lifecycle records file could not be read",
        },
      ],
    };
  }
  let input: unknown;
  try {
    input = JSON.parse(contents);
  } catch {
    return {
      status: "invalid",
      issues: [
        {
          code: "records-malformed-json",
          message: "Configured lifecycle records file is not valid JSON",
        },
      ],
    };
  }
  const parsed = parseRunRecordsSnapshot(input, policy, now);
  if (parsed.ok && endpoint) {
    const consumer = process.env.SHOWCASE_REGISTRY_CONSUMER;
    if (!["image-gate", "ruby-promotion", "harness"].includes(consumer ?? ""))
      return {
        status: "invalid",
        issues: [
          {
            code: "records-unreadable",
            message: "Registry consumer identity missing",
          },
        ],
      };
    try {
      const ack = await fetch(new URL(`/consumers/${consumer}`, endpoint), {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${process.env.SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reader: "railway-lifecycle-records-v1",
          recordsFile: endpoint.href,
          sha256: createHash("sha256").update(contents).digest("hex"),
          policySha256: createHash("sha256")
            .update(JSON.stringify(policy))
            .digest("hex"),
        }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
          : AbortSignal.timeout(10_000),
      });
      if (!ack.ok) throw new Error("Consumer activation failed");
    } catch (error) {
      if (signal?.aborted) throw error;
      return {
        status: "invalid",
        issues: [
          {
            code: "records-unreadable",
            message: "Registry consumer activation failed",
          },
        ],
      };
    }
  }
  return parsed.ok
    ? { status: "valid", snapshot: parsed.value }
    : { status: "invalid", issues: parsed.issues };
}
