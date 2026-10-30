import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { renderSurface } from "../../__tests__/render";
import { compositeComponents } from "../composites";
import { dataComponents } from "../data";
import { feedbackComponents } from "../feedback";
import { standardUI } from "../index";
import { inputComponents } from "../inputs";
import { layoutComponents } from "../layout";
import { mediaComponents } from "../media";
import { textComponents } from "../text";

/**
 * The fixture that react-core renders too, so a catalog difference between
 * the two fails here before an agent finds it.
 */
const FIXTURE = path.join(
  __dirname,
  "../../../../../../react-core/src/v2/generative-ui/standard/__tests__/fixtures/standard-all.json",
);

/** The fixture uses every standard component at least once. */
const fixtureSchema = z.object({
  components: z.array(
    z.object({ id: z.string(), component: z.string() }).passthrough(),
  ),
  data: z.record(z.string(), z.unknown()),
});
const fixture = fixtureSchema.parse(
  JSON.parse(fs.readFileSync(FIXTURE, "utf8")),
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
    expect(standardUI.components.size).toBe(69);
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

  it("is used in full by the React fixture", () => {
    const used = new Set(fixture.components.map((node) => node.component));
    const unused = [...standardUI.components.keys()].filter(
      (name) => !used.has(name),
    );
    expect(unused).toEqual([]);
  });

  it("renders the React fixture with no error", () => {
    const view = renderSurface(standardUI, fixture.components, fixture.data);
    const text = view.container.textContent ?? "";
    expect(text).toContain("Standard catalog fixture");
    // Template rows, template list items, the Map list of places, and a
    // composite.
    expect(text).toContain("Linus");
    expect(text).toContain("Café Central");
    expect(text).toContain("Walk dog");
    expect(text).toContain("Graz");
    expect(view.reportError).not.toHaveBeenCalled();
  });
});
