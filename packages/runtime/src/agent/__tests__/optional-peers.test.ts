import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as NodePath from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadOptionalPeer } from "../optional-peers";

const MISSING_PACKAGE = "@copilotkit/optional-peer-that-is-not-installed";

describe("loadOptionalPeer", () => {
  let fixtureDir: string;
  let throwingModuleUrl: string;

  beforeAll(() => {
    // A real module on disk that fails while it evaluates, the way a broken
    // install or a bad provider config would.
    fixtureDir = mkdtempSync(join(tmpdir(), "optional-peers-"));
    const throwingModulePath = join(fixtureDir, "peer-that-throws.mjs");
    writeFileSync(
      throwingModulePath,
      'throw Object.assign(new Error("boom inside the peer"), { code: "ERR_PEER_BOOM" });\n',
    );
    throwingModuleUrl = pathToFileURL(throwingModulePath).href;
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("returns the loaded module when the package resolves", async () => {
    const path = await loadOptionalPeer<typeof NodePath>(
      "node:path",
      "path helpers",
    );

    expect(path.basename("/models/claude.txt")).toBe("claude.txt");
  });

  it("names the package and the install command when the package is missing", async () => {
    const error = await loadOptionalPeer(
      MISSING_PACKAGE,
      '"anthropic/claude-sonnet-4-6" models',
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      message:
        'Install @copilotkit/optional-peer-that-is-not-installed to use "anthropic/claude-sonnet-4-6" models: npm install @copilotkit/optional-peer-that-is-not-installed',
      cause: expect.objectContaining({
        code: expect.stringMatching(/^(ERR_)?MODULE_NOT_FOUND$/),
      }),
    });
  });

  it("rethrows an error raised inside the package unchanged", async () => {
    await expect(
      loadOptionalPeer(throwingModuleUrl, '"openai/gpt-5" models'),
    ).rejects.toMatchObject({
      message: "boom inside the peer",
      code: "ERR_PEER_BOOM",
    });
  });
});
