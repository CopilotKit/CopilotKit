import { describe, expect, test } from "vitest";
import { standardUI } from "@copilotkit/react-core/v2/generative-ui";
import { KUMO_COVERAGE } from "../coverage";
import { kumoUI } from "../ui";

describe("kumoUI", () => {
  test("covers every standard component", () => {
    const names = Object.keys(standardUI.manifestComponents).sort();
    expect(names).toHaveLength(69);
    expect(Object.keys(KUMO_COVERAGE).sort()).toEqual(names);
  });

  test("the model sees the standard catalog", () => {
    expect(kumoUI.manifestComponents).toEqual(standardUI.manifestComponents);
  });

  test.each(Object.entries(KUMO_COVERAGE))(
    "%s: override matches coverage",
    (name, kind) => {
      const kumo = kumoUI.components.get(name)?.component;
      const standard = standardUI.components.get(name)?.component;
      expect(kumo).toBeDefined();
      if (kind === "standard") expect(kumo).toBe(standard);
      else expect(kumo).not.toBe(standard);
    },
  );
});
