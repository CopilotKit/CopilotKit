import { expect, it } from "vitest";

import frontendRegistryData from "@/data/frontend-registry.json";
import {
  FRONTEND_OPTIONS,
  getFrontendSupport,
  isRunnableFrontend,
} from "../frontend-options";

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

it("exposes supported, docs-only, and permanent exception states", () => {
  expect(getFrontendSupport("beautiful-chat", "angular")).toEqual({
    state: "supported",
  });
  expect(getFrontendSupport("cli-start", "angular")).toEqual({
    state: "docs-only",
  });
  expect(
    getFrontendSupport("declarative-json-render", "angular"),
  ).toMatchObject({
    state: "not-applicable",
    owner: "Angular SDK maintainers",
    review_date: "2027-01-21",
  });
});
