import { describe, expect, it } from "vitest";
import fixture from "./fixtures/standard-catalog-all.json";
import { renderStandard } from "./standard-test-utils";
import {
  standardCatalog,
  standardDefinitions,
} from "../a2ui-react/catalog/standard";

type FixtureComponent = { id: string; component: string };

describe("standard catalog fixture", () => {
  it("uses every component in the catalog at least once", () => {
    const used = new Set(
      (fixture.components as FixtureComponent[]).map((c) => c.component),
    );
    const missing = Object.keys(standardDefinitions).filter(
      (n) => !used.has(n),
    );
    expect(missing).toEqual([]);
  });

  it("renders the whole fixture without a render error", async () => {
    const v = renderStandard(
      fixture.components as unknown[],
      fixture.data as Record<string, unknown>,
    );
    expect(await v.findByText("Standard catalog fixture")).toBeTruthy();
    expect(v.queryByText(/A2UI render error/)).toBeNull();
    expect(v.queryByText(/Unknown component/)).toBeNull();
  });

  it("registers the expected number of components", () => {
    expect(standardCatalog.components.size).toBe(
      Object.keys(standardDefinitions).length,
    );
  });
});
