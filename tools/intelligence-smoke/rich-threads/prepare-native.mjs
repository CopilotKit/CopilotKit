import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join, dirname, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
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
const files = [];
for (const [prefix, destination] of [
  ["showcase/integrations/strands-typescript/src/agent", "src/agent"],
  ["showcase/integrations/strands-typescript/src/cvdiag", "src/cvdiag"],
  ["showcase/shared/typescript/tools", "shared-tools"],
  [
    "tools/intelligence-smoke/rich-threads/application/Strands.Dockerfile",
    "Dockerfile",
  ],
]) {
  const { stdout: paths } = await execute(
    "git",
    ["ls-tree", "-r", "--name-only", revision, "--", prefix],
    { cwd: source },
  );
  assert.ok(paths.trim(), `Missing committed build source: ${prefix}`);
  for (const path of paths.trim().split("\n")) {
    const target =
      path === prefix ? destination : join(destination, relative(prefix, path));
    const { stdout: bytes } = await execute(
      "git",
      ["show", `${revision}:${path}`],
      { cwd: source, encoding: "buffer", maxBuffer: 10 * 1024 * 1024 },
    );
    await mkdir(dirname(join(output, target)), { recursive: true });
    await writeFile(join(output, target), bytes);
    files.push({
      path,
      target,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
}
await writeFile(
  join(output, "source-manifest.json"),
  JSON.stringify({ revision, framework: "strands-typescript", files }, null, 2),
);
