import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { compositeComponents } from "../composites";
import { dataComponents } from "../data";
import { feedbackComponents } from "../feedback";
import { standardUI } from "../index";
import { inputComponents } from "../inputs";
import { layoutComponents } from "../layout";
import { mediaComponents } from "../media";
import { textComponents } from "../text";
import { renderSurface } from "./render";

// maplibre-gl is an optional peer dependency. This models an app that does
// not install it: the import rejects, and the Map shows a list of places.
vi.mock("maplibre-gl", () => {
  throw new Error("Cannot find package 'maplibre-gl'");
});

/** The fixture uses every standard component at least once. */
const fixtureSchema = z.object({
  components: z.array(
    z.object({ id: z.string(), component: z.string() }).passthrough(),
  ),
  data: z.record(z.string(), z.unknown()),
});
const fixture = fixtureSchema.parse(
  JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures/standard-all.json"), "utf8"),
  ),
);

describe("standardUI", () => {
  it("has the id copilotkit/standard@1", () => {
    expect(standardUI.id).toBe("copilotkit/standard@1");
  });

  it("has every component of every group once, each with a description", () => {
    const groupNames = [
      layoutComponents,
      textComponents,
      inputComponents,
      feedbackComponents,
      dataComponents,
      mediaComponents,
      compositeComponents,
    ].flatMap((group) => Object.keys(group));
    // A name in two groups would collapse into one entry here.
    expect([...standardUI.components.keys()]).toEqual(groupNames);
    expect(standardUI.components.size).toBe(73);
    for (const [name, manifest] of Object.entries(
      standardUI.manifestComponents,
    )) {
      expect(manifest.description, name).toMatch(/\S/);
    }
  });

  it("has a manifest that survives a JSON round trip", () => {
    const manifest = standardUI.manifestComponents;
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it("is used in full by the fixture", () => {
    const used = new Set(fixture.components.map((node) => node.component));
    const unused = [...standardUI.components.keys()].filter(
      (name) => !used.has(name),
    );
    expect(unused).toEqual([]);
  });

  it("renders the fixture with no error", async () => {
    const view = renderSurface(standardUI, fixture.components, fixture.data);
    expect(await view.findByText("Standard catalog fixture")).toBeTruthy();
    // Template rows, template list items, the Map list of places, and a
    // composite.
    expect(await view.findByText("Linus")).toBeTruthy();
    expect(await view.findByText("Café Central")).toBeTruthy();
    expect(await view.findByText("Walk dog")).toBeTruthy();
    expect(await view.findByText("Graz")).toBeTruthy();
    expect(view.reportError).not.toHaveBeenCalled();
  });
});
