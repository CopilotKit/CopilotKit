import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPublishedV1LayoutBuildDoneHook } from "../../tsdown.config";

describe("runtime tsdown v1 layout hook", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
  });

  it("flattens only after both formats finish and resets for the next cycle", () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilotkit-runtime-tsdown-"),
    );
    temporaryDirectories.push(temporaryDirectory);
    const distDirectory = path.join(temporaryDirectory, "dist");
    const hook = createPublishedV1LayoutBuildDoneHook(distDirectory, [
      "esm",
      "cjs",
    ]);

    const writeDeprecatedOutput = (fileName: string) => {
      const deprecatedDirectory = path.join(distDirectory, "v1-deprecated");
      fs.mkdirSync(deprecatedDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(deprecatedDirectory, fileName),
        "export {};\n",
      );
    };

    writeDeprecatedOutput("first.mjs");
    hook({ options: { format: "es" } });
    expect(
      fs.existsSync(path.join(distDirectory, "v1-deprecated", "first.mjs")),
    ).toBe(true);

    hook({ options: { format: "cjs" } });
    expect(fs.existsSync(path.join(distDirectory, "first.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(distDirectory, "v1-deprecated"))).toBe(
      false,
    );

    writeDeprecatedOutput("second.mjs");
    hook({ options: { format: "cjs" } });
    expect(
      fs.existsSync(path.join(distDirectory, "v1-deprecated", "second.mjs")),
    ).toBe(true);

    hook({ options: { format: "es" } });
    expect(fs.existsSync(path.join(distDirectory, "second.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(distDirectory, "v1-deprecated"))).toBe(
      false,
    );
  });

  it("fails after both formats finish when the required v1 output is absent", () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilotkit-runtime-tsdown-"),
    );
    temporaryDirectories.push(temporaryDirectory);
    const distDirectory = path.join(temporaryDirectory, "dist");
    const hook = createPublishedV1LayoutBuildDoneHook(distDirectory, [
      "esm",
      "cjs",
    ]);

    expect(() => hook({ options: { format: "es" } })).not.toThrow();
    expect(() => hook({ options: { format: "cjs" } })).toThrow(
      `Missing required deprecated v1 build output directory: ${path.join(
        distDirectory,
        "v1-deprecated",
      )}`,
    );
  });
});
