import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { parseArgs } from "node:util";
import { pollRunStatus } from "../status-poll.mjs";
import { reportCleanupVerified } from "./cleanup-verdict.mjs";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "single" },
    output: { type: "string" },
  },
});
assert.ok(["single", "acceptance", "crash-recovery"].includes(values.mode));
assert.ok(values.output, "--output required");
const base = new URL(process.env.RICH_RUNNER_URL);
assert.ok(
  base.protocol === "https:" &&
    !base.username &&
    !base.password &&
    !base.search &&
    !base.hash,
  "HTTPS runner origin required",
);
assert.ok(process.env.RICH_RUNNER_TOKEN?.length >= 32, "Runner token required");
const root = resolve(values.output);
await mkdir(root, { recursive: false, mode: 0o700 });
async function request(
  path,
  options = {},
  timeout = 30_000,
  allowStatusError = false,
) {
  const url = new URL(path, base);
  assert.equal(url.origin, base.origin, "Runner response changed origin");
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.RICH_RUNNER_TOKEN}`,
    },
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  });
  if (!allowStatusError)
    assert.ok(response.ok, `Runner HTTP ${response.status}`);
  return response;
}
const started = await (
  await request("/runs", {
    method: "POST",
    body: JSON.stringify({ mode: values.mode }),
  })
).json();
assert.match(started.id, /^[a-zA-Z0-9_-]+$/);
assert.equal(started.statusUrl, `/runs/${started.id}`);
assert.equal(started.resultsUrl, `/results/${started.id}/`);
await writeFile(join(root, "trigger.json"), JSON.stringify(started, null, 2), {
  flag: "wx",
  mode: 0o600,
});
const deadline =
  Date.now() + (values.mode === "acceptance" ? 190 : 70) * 60_000;
const receipt = await pollRunStatus({
  id: started.id,
  deadline,
  request: (timeout) => request(started.statusUrl, {}, timeout, true),
});
await writeFile(
  join(root, "runner-receipt.json"),
  JSON.stringify(receipt, null, 2),
  { flag: "wx", mode: 0o600 },
);
const manifest = await (await request(`${started.resultsUrl}manifest`)).json();
assert.ok(
  Array.isArray(manifest.files) && manifest.files.length <= 1000,
  "Invalid result manifest",
);
let total = 0;
for (const file of manifest.files) {
  assert.match(file.path, /^[a-zA-Z0-9_./-]+$/);
  assert.ok(
    !file.path.startsWith("/") &&
      file.path
        .split("/")
        .every((part) => part && part !== "." && part !== ".."),
    "Unsafe result path",
  );
  assert.ok(
    Number.isSafeInteger(file.bytes) &&
      file.bytes >= 0 &&
      file.bytes <= 32 * 1024 * 1024,
  );
  total += file.bytes;
  assert.ok(total <= 128 * 1024 * 1024, "Result export exceeds bound");
  assert.match(file.sha256, /^[a-f0-9]{64}$/);
  const response = await request(`${started.resultsUrl}${file.path}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert.ok(size <= file.bytes, "Result larger than manifest");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  assert.equal(size, file.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
  const target = join(root, "results", file.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
}
assert.ok(
  receipt.status === "passed" ||
    (values.mode === "crash-recovery" &&
      receipt.status === "interrupted-cleaned"),
  "Hosted run did not pass",
);
assert.ok(
  reportCleanupVerified(receipt),
  "Hosted active-resource cleanup not verified",
);
assert.equal(
  receipt.deadlineExceeded,
  false,
  "Hosted lifetime was not verified",
);
if (values.mode === "crash-recovery")
  assert.equal(receipt.crashReached, true, "Crash point was not reached");
if (values.mode !== "crash-recovery")
  assert.equal(receipt.exitCode, 0, "Hosted controller failed");
console.log(
  `Railway ${values.mode} completed: ${started.id}; physical deletion ${receipt.cleanup === "passed" ? "verified" : "pending provider removal (48h retention expectation)"}`,
);
