import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

it("keeps the Strands TypeScript agent allow-list in the frontend catalog", () => {
  const contract = readFileSync(
    path.join(
      REPO_ROOT,
      "examples/integrations/strands-typescript/agent/src/a2ui-contract.ts",
    ),
    "utf8",
  );
  const definitions = readFileSync(
    path.join(
      REPO_ROOT,
      "examples/integrations/strands-typescript/src/app/declarative-generative-ui/definitions.ts",
    ),
    "utf8",
  );
  const allowList = contract.match(
    /DYNAMIC_A2UI_COMPONENT_NAMES = \[([\s\S]*?)\] as const/,
  )?.[1];

  expect(allowList).toBeDefined();
  const componentNames = [...allowList!.matchAll(/"([^"]+)"/g)].map(
    ([, name]) => name,
  );
  const catalogNames = new Set(
    [...definitions.matchAll(/^  ([A-Za-z][A-Za-z0-9]*): \{/gm)].map(
      ([, name]) => name,
    ),
  );

  expect(componentNames).not.toHaveLength(0);
  expect(componentNames.filter((name) => !catalogNames.has(name))).toEqual([]);
});
