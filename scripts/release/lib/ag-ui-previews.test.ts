import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { materializeAgUiPreviews } from "./ag-ui-previews.js";

const COMMIT = "b9751f011fb0701c8a2e349bdfc757071434c782";
const NAME = "@ag-ui/client";
const URL = `https://pkg.pr.new/ag-ui-protocol/ag-ui/${NAME}@${COMMIT}`;
const directories: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ag-ui-previews-test-"));
  directories.push(root);
  const directory = join(root, "output");
  const source = join(root, "source");
  mkdirSync(join(source, "package"), { recursive: true });

  function tarball(manifest: object) {
    writeFileSync(
      join(source, "package/package.json"),
      JSON.stringify(manifest),
    );
    return execFileSync("tar", ["-czf", "-", "-C", source, "package"]);
  }

  const bytes = tarball({ name: NAME, version: "0.0.59" });
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  function rootPins(overrides: Record<string, string>) {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ pnpm: { overrides } }),
    );
  }
  function lock(checksum: string | undefined) {
    writeFileSync(
      join(root, "pnpm-lock.yaml"),
      stringify({
        packages: {
          [`${NAME}@${URL}`]: {
            version: "0.0.59",
            resolution: { tarball: URL, integrity: checksum },
          },
        },
      }),
    );
  }
  function response(body = bytes, headers = {}) {
    return new Response(new Uint8Array(body), {
      headers: { "x-commit-key": `ag-ui-protocol:ag-ui:${COMMIT}`, ...headers },
    });
  }
  rootPins({ [NAME]: URL });
  lock(integrity);
  const download = vi.fn<typeof fetch>().mockResolvedValue(response());
  const packedTarballs = new Map<string, string>();
  const run = () =>
    materializeAgUiPreviews({
      root,
      directory,
      packedTarballs,
      fetch: download,
    });
  return {
    root,
    directory,
    bytes,
    tarball,
    rootPins,
    lock,
    response,
    download,
    packedTarballs,
    run,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("materializeAgUiPreviews", () => {
  it.each(["^0.0.59", "latest", "next", "https://example.com/client.tgz"])(
    "leaves non-preview pin %s unchanged without reading a lockfile or downloading",
    async (pin) => {
      const f = fixture();
      f.rootPins({ [NAME]: pin });
      rmSync(join(f.root, "pnpm-lock.yaml"));
      await expect(f.run()).resolves.toEqual(new Map());
      expect(f.download).not.toHaveBeenCalled();
      expect(existsSync(f.directory)).toBe(false);
    },
  );

  it("materializes the exact locked bytes and ignores parent override selectors", async () => {
    const f = fixture();
    f.rootPins({ [NAME]: URL, "@ag-ui/mcp-middleware>@ag-ui/client": URL });
    const paths = await f.run();
    const path = join(f.directory, "client.tgz");
    expect(paths).toEqual(new Map([[NAME, path]]));
    expect(readFileSync(path)).toEqual(f.bytes);
    expect(f.download).toHaveBeenCalledExactlyOnceWith(URL, {
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    `https://pkg.pr.new/ag-ui-protocol/ag-ui/${NAME}@latest`,
    `https://pkg.pr.new/ag-ui-protocol/ag-ui/@ag-ui/core@${COMMIT}`,
    `https://pkg.pr.new/another-org/ag-ui/${NAME}@${COMMIT}`,
  ])("rejects unsupported or mismatched pins: %s", async (pin) => {
    const f = fixture();
    f.rootPins({ [NAME]: pin });
    await expect(f.run()).rejects.toThrow(/unsupported AG-UI preview pin/i);
    expect(f.download).not.toHaveBeenCalled();
  });

  it("rejects a preview graph spanning different commits", async () => {
    const f = fixture();
    f.rootPins({
      [NAME]: URL,
      "@ag-ui/core": `https://pkg.pr.new/ag-ui-protocol/ag-ui/@ag-ui/core@${"a".repeat(40)}`,
    });
    await expect(f.run()).rejects.toThrow(/same commit/i);
    expect(f.download).not.toHaveBeenCalled();
  });

  it.each([undefined, "sha256-not-the-required-integrity"])(
    "requires a matching SHA512 lock resolution before fetching: %s",
    async (integrity) => {
      const f = fixture();
      f.lock(integrity);
      await expect(f.run()).rejects.toThrow(/locked SHA512/i);
      expect(f.download).not.toHaveBeenCalled();
    },
  );

  it("rejects stale packed preview dependencies before replacing their resolutions", async () => {
    const f = fixture();
    const packed = join(f.root, "copilotkit-angular.tgz");
    writeFileSync(
      packed,
      f.tarball({
        name: "@copilotkit/angular",
        version: "0.5.1",
        dependencies: { [NAME]: URL.replace(COMMIT, "a".repeat(40)) },
      }),
    );
    f.packedTarballs.set("@copilotkit/angular", packed);
    await expect(f.run()).rejects.toThrow(/packed.*preview.*root pin/i);
    expect(f.download).not.toHaveBeenCalled();
  });

  it("rejects a response from a different commit", async () => {
    const f = fixture();
    f.download.mockResolvedValue(
      f.response(f.bytes, { "x-commit-key": "ag-ui-protocol:ag-ui:wrong" }),
    );
    await expect(f.run()).rejects.toThrow(/commit/i);
    expect(existsSync(f.directory)).toBe(false);
  });

  it("rejects changed tarball bytes before writing them", async () => {
    const f = fixture();
    f.download.mockResolvedValue(f.response(Buffer.from("different bytes")));
    await expect(f.run()).rejects.toThrow(/checksum/i);
    expect(existsSync(f.directory)).toBe(false);
  });

  it.each([
    { name: "@ag-ui/core", version: "0.0.59" },
    { name: NAME, version: "0.0.60" },
  ])("rejects a mismatched packed identity: %j", async (manifest) => {
    const f = fixture();
    const bytes = f.tarball(manifest);
    f.lock(`sha512-${createHash("sha512").update(bytes).digest("base64")}`);
    f.download.mockResolvedValue(f.response(bytes));
    await expect(f.run()).rejects.toThrow(/package identity/i);
    expect(existsSync(f.directory)).toBe(false);
  });

  it("fails loudly on HTTP failure", async () => {
    const f = fixture();
    f.download.mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(f.run()).rejects.toThrow(/503/);
    expect(existsSync(f.directory)).toBe(false);
  });

  it("propagates download failures without retrying", async () => {
    const f = fixture();
    const failure = new Error("network unavailable");
    f.download.mockRejectedValue(failure);
    await expect(f.run()).rejects.toBe(failure);
    expect(f.download).toHaveBeenCalledOnce();
  });
});
