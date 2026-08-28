import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const guide = readFileSync(
  join(process.cwd(), "src/content/docs/frontends/react-native.mdx"),
  "utf8",
);

test("documents stock Metro for the React Native headless surface", () => {
  expect(guide).toContain("works with Metro's stock configuration");
  expect(guide).toContain(
    "module.exports = mergeConfig(getDefaultConfig(__dirname), {});",
  );
  expect(guide).not.toContain("resolveRequest");
  expect(guide).not.toContain('unstable_conditionNames: ["browser"]');
  expect(guide).not.toContain("@segment/analytics-node");
});
