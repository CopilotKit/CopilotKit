import assert from "node:assert/strict";
import { readFile, lstat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  policy,
  parseRunRecordsSnapshot,
  publishSnapshot,
} from "./contract.mts";
import { digest, policyDigest } from "./distribution.mjs";

/** Install alongside the actual consumer, with its SAME configured durable record path.
 * The remote request cannot select a path, consumer identity, policy or approval list.
 */
export async function receiveSnapshot(request, env = process.env) {
  const file = env.SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE;
  assert.ok(
    file?.startsWith("/"),
    "Consumer ownership-file activation missing",
  );
  assert.ok(
    ["image-gate", "ruby-promotion", "harness"].includes(
      env.SHOWCASE_REGISTRY_CONSUMER,
    ),
  );
  assert.equal(request.consumer, env.SHOWCASE_REGISTRY_CONSUMER);
  assert.equal(
    request.policySha256,
    policyDigest(),
    "Receiver has a different committed policy",
  );
  const parsed = parseRunRecordsSnapshot(request.snapshot, policy, new Date());
  assert.ok(parsed.ok, "Invalid incoming snapshot");
  const bytes = JSON.stringify(parsed.value, null, 2) + "\n";
  assert.equal(digest(bytes), request.sha256);
  // Existing, explicitly initialized evidence is required. Missing configuration is never empty.
  const old = JSON.parse(await readFile(file, "utf8"));
  const before = parseRunRecordsSnapshot(old, policy, new Date());
  assert.ok(before.ok, "Invalid existing consumer evidence");
  for (const previous of before.value.runs)
    assert.ok(
      parsed.value.runs.some((r) => r.runId === previous.runId),
      "Cannot discard terminal ownership",
    );
  // Reuse the proof publisher's monotonic ownership/phase checks and atomic publication.
  for (const run of parsed.value.runs) await publishSnapshot(file, { run });
  const final = await readFile(file, "utf8");
  assert.equal(digest(final), request.sha256, "Consumer publication differs");
  const stat = await lstat(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  return {
    consumer: env.SHOWCASE_REGISTRY_CONSUMER,
    recordsFile: file,
    sha256: digest(final),
    policySha256: policyDigest(),
    valid: true,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      assert.ok(input.length < 8 * 1024 * 1024);
    }
    console.log(JSON.stringify(await receiveSnapshot(JSON.parse(input))));
  } catch {
    console.error("Registry snapshot receiver refused publication");
    process.exitCode = 1;
  }
}
