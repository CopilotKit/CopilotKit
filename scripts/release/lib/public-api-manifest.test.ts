import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildPublicApiManifest,
  renderPublicApiManifest,
} from "./public-api-manifest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function provenancePaths(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) provenancePaths(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "path" && typeof child === "string") out.push(child);
      else provenancePaths(child, out);
    }
  }
  return out;
}

describe("public API manifest", () => {
  it("matches the public package and source declarations", () => {
    const generated = renderPublicApiManifest(buildPublicApiManifest(root));
    const committed = readFileSync(
      resolve(root, "scripts/release/public-api/manifest.v1.json"),
      "utf8",
    );

    expect(committed).toBe(generated);
  });

  it("emits posix provenance paths", () => {
    const generated = buildPublicApiManifest(root);
    for (const path of provenancePaths(generated)) {
      expect(path).not.toContain("\\");
    }
  });
});
