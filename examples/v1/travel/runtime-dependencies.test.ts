import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, parse } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const require = createRequire(import.meta.url);

const packageMetadataSchema = z.object({
  name: z.string(),
  version: z.string(),
  peerDependencies: z.record(z.string()).optional(),
});

const travelPackageSchema = z.object({
  dependencies: z.object({
    react: z.string(),
    "react-dom": z.string(),
  }),
});

const readPackageMetadata = (packageName: string) => {
  let directory = dirname(require.resolve(packageName));

  while (directory !== parse(directory).root) {
    const packageJsonPath = join(directory, "package.json");

    if (existsSync(packageJsonPath)) {
      const metadata = packageMetadataSchema.parse(
        JSON.parse(readFileSync(packageJsonPath, "utf8")),
      );

      if (metadata.name === packageName) {
        return metadata;
      }
    }

    directory = dirname(directory);
  }

  throw new Error(`Could not find package metadata for ${packageName}`);
};

describe("React runtime dependencies", () => {
  it("declares React and React Leaflet contracts for the installed React major", () => {
    const packageJson = travelPackageSchema.parse(
      JSON.parse(
        readFileSync(new URL("./package.json", import.meta.url), "utf8"),
      ),
    );
    const react = readPackageMetadata("react");
    const reactDom = readPackageMetadata("react-dom");
    const reactLeaflet = readPackageMetadata("react-leaflet");
    const reactMajor = react.version.split(".")[0];
    const declaredReactMajor =
      packageJson.dependencies.react.match(/^(?:\^)?(\d+)/)?.[1];
    const declaredReactDomMajor =
      packageJson.dependencies["react-dom"].match(/^(?:\^)?(\d+)/)?.[1];

    expect(reactDom.version.split(".")[0]).toBe(reactMajor);
    expect(declaredReactMajor).toBe(reactMajor);
    expect(declaredReactDomMajor).toBe(reactMajor);
    expect(reactLeaflet.peerDependencies?.react).toMatch(
      new RegExp(`^\\^${reactMajor}\\.`),
    );
    expect(reactLeaflet.peerDependencies?.["react-dom"]).toMatch(
      new RegExp(`^\\^${reactMajor}\\.`),
    );
  });
});
