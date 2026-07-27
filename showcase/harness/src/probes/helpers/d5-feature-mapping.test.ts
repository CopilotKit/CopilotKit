import { expect, test } from "vitest";

import frontendRegistry from "../../../../shared/frontend-registry.json";
import { REGISTRY_TO_D5 } from "./d5-feature-mapping.js";

test("every supported frontend feature resolves to a deterministic probe", () => {
  const missing = Object.entries(frontendRegistry.feature_support)
    .filter(([, declarations]) =>
      Object.values(declarations).some(
        (declaration) => declaration.state === "supported",
      ),
    )
    .map(([feature]) => feature)
    .filter((feature) => REGISTRY_TO_D5[feature] === undefined)
    .sort();

  expect(missing).toEqual([]);
});
