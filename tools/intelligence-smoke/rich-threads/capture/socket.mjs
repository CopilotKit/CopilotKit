import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function runtimeSocket(runtimeEntry) {
  const requireRuntime = createRequire(runtimeEntry);
  const root = join(dirname(requireRuntime.resolve("phoenix")), "../..");
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  assert.equal(manifest.name, "phoenix");
  const target = manifest.exports?.import ?? manifest.exports?.["."]?.import;
  assert.equal(
    typeof target,
    "string",
    "Pinned Phoenix package must expose an ESM entrypoint",
  );
  // require.resolve selects a separate CJS class. The runtime imports this ESM
  // target; hooking CJS would silently capture zero actual ingestion events.
  return (await import(pathToFileURL(join(root, target)))).Socket;
}
