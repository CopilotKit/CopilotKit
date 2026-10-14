import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
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
await writeFile(
  join(output, "source-manifest.json"),
  JSON.stringify({ revision, files }, null, 2),
);
