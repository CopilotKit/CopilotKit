import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

const nextPackageJson = JSON.parse(
  readFileSync(require.resolve("next/package.json"), "utf8"),
) as {
  version: string;
  engines: { node: string };
};
const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");

describe("README runtime requirements", () => {
  it("documents the installed Next.js major and required Node.js version", () => {
    const nextMajor = nextPackageJson.version.match(/^(\d+)\./)?.[1];
    const requiredNodeVersion =
      nextPackageJson.engines.node.match(/>=(\d+\.\d+\.\d+)/)?.[1];

    expect(nextMajor).toBeDefined();
    expect(requiredNodeVersion).toBeDefined();
    expect(readme).toMatch(
      new RegExp(`Built%20with-Next\\.js%20${nextMajor}-`),
    );
    expect(readme).toMatch(
      new RegExp(`Node\\.js ${requiredNodeVersion?.replaceAll(".", "\\.")}\\+`),
    );
  });
});
