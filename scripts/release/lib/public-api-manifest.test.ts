import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildPublicApiManifest,
  renderPublicApiManifest,
} from "./public-api-manifest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("public API manifest", () => {
  it("matches the public package and source declarations", () => {
    const generated = renderPublicApiManifest(buildPublicApiManifest(root));
    const committed = readFileSync(
      resolve(root, "scripts/release/public-api/manifest.v1.json"),
      "utf8",
    );

    expect(committed).toBe(generated);
    const paths: string[] = [];
    JSON.parse(generated, (key, value) => {
      if (key === "path" && typeof value === "string") paths.push(value);
      return value;
    });
    expect(paths.some((path) => path.includes("\\"))).toBe(false);
  });
});
