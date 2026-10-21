import { expect, it } from "vitest";

import frontendRegistryData from "@/data/frontend-registry.json";
import { FRONTEND_OPTIONS, isRunnableFrontend } from "../frontend-options";

it("derives frontend picker identities from the normalized registry", () => {
  expect(FRONTEND_OPTIONS).toEqual(
    frontendRegistryData.frontends.map(({ id, name, icon, summary }) => ({
      id,
      name,
      icon,
      summary,
    })),
  );
});

it("exposes runnable frontend capability independently from backend support", () => {
  expect(isRunnableFrontend("react")).toBe(true);
  expect(isRunnableFrontend("angular")).toBe(true);
  expect(isRunnableFrontend("vue")).toBe(false);
});
