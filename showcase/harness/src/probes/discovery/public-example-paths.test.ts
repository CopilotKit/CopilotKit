import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
// The five apps linked from copilotkit.ai/examples. Their paths are load-bearing:
// the public website links and the Vercel project root directories both point at
// them, so a move needs those updated in the same change. `relocatedPath` is the
// consolidated-catalog location each one must NOT drift into on its own.
const PUBLIC_EXAMPLES = [
  {
    currentPath: "examples/v1/chat-with-your-data",
    relocatedPath: "examples/showcases/chat-with-your-data",
    packageName: "@copilotkit-examples/chat-with-your-data",
  },
  {
    currentPath: "examples/v1/form-filling",
    relocatedPath: "examples/showcases/form-filling",
    packageName: "@copilotkit-examples/form-filling",
  },
  {
    // Distinct from `examples/showcases/research-canvas`, which is a different demo.
    currentPath: "examples/v1/research-canvas",
    relocatedPath: "examples/canvas/research-canvas",
    packageName: "@copilotkit-examples/research-canvas",
  },
  {
    currentPath: "examples/v1/state-machine",
    relocatedPath: "examples/showcases/state-machine",
    packageName: "@copilotkit-examples/state-machine",
  },
  {
    currentPath: "examples/v1/travel",
    relocatedPath: "examples/showcases/travel",
    packageName: "@copilotkit-examples/travel",
  },
] as const;

test("public v2 examples stay at the paths the website and deployments point at", () => {
  for (const example of PUBLIC_EXAMPLES) {
    const manifest = path.join(REPO_ROOT, example.currentPath, "package.json");

    expect(existsSync(manifest), example.currentPath).toBe(true);
    expect(
      existsSync(path.join(REPO_ROOT, example.relocatedPath)),
      example.relocatedPath,
    ).toBe(false);
    expect(JSON.parse(readFileSync(manifest, "utf8"))).toMatchObject({
      name: example.packageName,
    });
  }
});
