import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { globSync } from "glob";
import { expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const sharedPythonTools = resolve(
  repositoryRoot,
  "showcase/shared/python/tools",
);

/**
 * The Python integration images get the shared tools through
 * `COPY tools/ /app/tools/` and nothing else, so the `query_data` dataset has
 * to live inside `tools/`. When it lived next to it, those images silently
 * served the 3-row mock and the beautiful-chat charts rendered a 2-slice pie
 * (PR #6271); this test is the ratchet.
 */
const integrationsCopyingSharedTools = globSync(
  "showcase/integrations/*/Dockerfile",
  { cwd: repositoryRoot, posix: true },
)
  .filter((dockerfile) =>
    /^COPY\b.*\btools\/ \/app\/tools\/$/m.test(
      readFileSync(resolve(repositoryRoot, dockerfile), "utf8"),
    ),
  )
  .map((dockerfile) => dockerfile.split("/")[2]);

test("integrations that copy the shared Python tools exist", () => {
  expect(integrationsCopyingSharedTools.length).toBeGreaterThan(0);
});

test.each(integrationsCopyingSharedTools)(
  "%s ships the query_data dataset inside tools/",
  (integration) => {
    const tools = resolve(
      repositoryRoot,
      "showcase/integrations",
      integration,
      "tools",
    );
    expect(realpathSync(tools)).toBe(realpathSync(sharedPythonTools));
    expect(existsSync(join(tools, "data", "db.csv"))).toBe(true);
  },
);

test("query_data loads the real dataset from a tools/-only copy", () => {
  // Mirror the image: dereference tools/ into an otherwise empty directory,
  // then load the module the way the agent does at startup.
  const image = mkdtempSync(join(tmpdir(), "query-data-packaging-"));
  try {
    cpSync(sharedPythonTools, join(image, "tools"), {
      recursive: true,
      dereference: true,
    });
    const env = { ...process.env };
    delete env.SHOWCASE_ALLOW_MOCK_DATASET;
    const result = spawnSync(
      "python3",
      [
        "-I",
        "-c",
        [
          "import importlib.util, json, sys",
          "spec = importlib.util.spec_from_file_location('query_data', sys.argv[1])",
          "module = importlib.util.module_from_spec(spec)",
          "spec.loader.exec_module(module)",
          "print(json.dumps({'rows': len(module._cached_data), 'mock': module._cached_data is module._MOCK_DATA}))",
        ].join("\n"),
        join(image, "tools", "query_data.py"),
      ],
      { encoding: "utf8", env },
    );

    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const loaded = JSON.parse(result.stdout) as { rows: number; mock: boolean };
    expect(loaded.mock).toBe(false);
    expect(loaded.rows).toBeGreaterThan(3);
  } finally {
    rmSync(image, { recursive: true, force: true });
  }
});
