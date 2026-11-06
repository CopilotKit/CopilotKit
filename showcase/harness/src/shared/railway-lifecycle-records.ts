import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseRunRecordsSnapshot } from "./railway-lifecycle.js";
import type {
  LifecycleEvidence,
  RailwayLifecyclePolicy,
} from "./railway-lifecycle.js";

// Reviewed recovery for 21552a22b2: only docs-preview was added to permanent
// protection. Keep validating with the stricter current policy; acknowledge the
// publisher's policy. Neither hash may expand to an unreviewed future policy.
const docsPreviewPolicyTransition = {
  publisher: "4ded223bb02ea0cdf7ffed4fb8f78b70fbb50c9f74ae82d34addfc94f712c751",
  validator: "d3a7fe0c6eeda2fce0dc73779d2e19fdfbf9174abeaa07468b3aca21bd097410",
};

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
  let publicationPolicySha256: string | undefined;
  try {
    if (filePath.startsWith("https://")) {
      const validationPolicySha256 = createHash("sha256")
        .update(JSON.stringify(policy))
        .digest("hex");
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
        createHash("sha256").update(contents).digest("hex")
      )
        throw new Error("Registry bytes differ");
      publicationPolicySha256 = response.headers.get("x-policy-sha256") ?? "";
      if (
        publicationPolicySha256 !== validationPolicySha256 &&
        !(
          publicationPolicySha256 === docsPreviewPolicyTransition.publisher &&
          validationPolicySha256 === docsPreviewPolicyTransition.validator
        )
      )
        return {
          status: "invalid",
          issues: [
            {
              code: "records-policy-mismatch",
              message:
                "Registry policy differs from the committed policy; a reviewed policy transition is required",
            },
          ],
        };
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
          // Activation identifies the publication we actually fetched. Parsing
          // above always enforces the current committed validation policy.
          policySha256: publicationPolicySha256,
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
