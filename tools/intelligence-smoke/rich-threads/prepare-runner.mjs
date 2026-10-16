import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { compatibilityFiles } from "./lifecycle/railway/runner/deployment.mjs";
const execute = promisify(execFile);
const { values } = parseArgs({
  options: {
    source: { type: "string", default: process.cwd() },
    output: { type: "string" },
  },
});
assert.ok(values.output, "--output required");
const source = resolve(values.source),
  output = resolve(values.output);
const { stdout } = await execute("git", ["rev-parse", "HEAD"], { cwd: source });
const revision = stdout.trim();
assert.match(revision, /^[a-f0-9]{40}$/);
await mkdir(output, { recursive: false, mode: 0o700 });
const { stdout: listing } = await execute(
  "git",
  [
    "ls-tree",
    "-r",
    "--name-only",
    revision,
    "--",
    "package.json",
    "tools/intelligence-smoke/rich-threads",
    "tools/railway-disposable-proof",
    "showcase/scripts/railway-envs.ts",
    "showcase/harness/src/shared",
  ],
  { cwd: source },
);
const files = [];
for (const path of listing.trim().split("\n")) {
  // The GitHub invocation client is not a hosted runtime input.
  if (path === "tools/intelligence-smoke/rich-threads/trigger.mjs") continue;
  if (
    path.startsWith("showcase/harness/src/shared/") &&
    !path.startsWith("showcase/harness/src/shared/railway-lifecycle")
  )
    continue;
  assert.ok(
    !path
      .split("/")
      .some((part) => part.startsWith(".env") || part === "node_modules"),
    "Private/generated input forbidden",
  );
  const { stdout: bytes } = await execute(
    "git",
    ["show", `${revision}:${path}`],
    { cwd: source, encoding: "buffer", maxBuffer: 10 * 1024 * 1024 },
  );
  await mkdir(dirname(join(output, path)), { recursive: true });
  await writeFile(join(output, path), bytes);
  files.push({
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
assert.ok(
  files.some((file) => file.path.endsWith("/runner/Dockerfile")),
  "Committed provider runner Dockerfile required",
);
const frozenFiles = compatibilityFiles(files);
const sourceManifest =
  JSON.stringify(
    { revision, files, compatibilityFiles: frozenFiles },
    null,
    2,
  ) + "\n";
const policySource = stripTypeScriptTypes(
  await readFile(join(output, "showcase/scripts/railway-envs.ts"), "utf8"),
);
const { DISPOSABLE_LIFECYCLE_POLICY: policy } = await import(
  `data:text/javascript;base64,${Buffer.from(policySource).toString("base64")}`
);
assert.ok(policy, "Committed lifecycle policy required");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(join(output, "source-manifest.json"), sourceManifest);
await writeFile(
  join(output, "runner-identity.json"),
  JSON.stringify(
    {
      protocolVersion: 1,
      sourceRevision: revision,
      sourceManifestSha256: sha256(sourceManifest),
      compatibilitySha256: sha256(JSON.stringify(frozenFiles)),
      policySha256: sha256(JSON.stringify(policy)),
    },
    null,
    2,
  ) + "\n",
);
