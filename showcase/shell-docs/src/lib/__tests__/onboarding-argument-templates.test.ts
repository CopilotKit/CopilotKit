import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ARGUMENT_TEMPLATES,
  fillArgumentTemplate,
  ONBOARDING_ARGUMENT_VERSION,
} from "@/lib/onboarding-argument-templates";

/** Recomputes the pinned version the way the doc comment describes it. */
function computeVersion(): string {
  const hash = createHash("sha256");
  for (const key of Object.keys(ARGUMENT_TEMPLATES).sort()) {
    hash.update(`${key}:${ARGUMENT_TEMPLATES[key as keyof typeof ARGUMENT_TEMPLATES]}\n`);
  }
  return hash.digest("hex").slice(0, 12);
}

describe("onboarding argument templates", () => {
  // The ratchet. Editing a sentence without bumping the constant is the exact
  // gap PE-255 exists to close, so it fails here rather than shipping a version
  // that reports a wording nobody was served.
  it("pins a version that matches the templates", () => {
    expect(ONBOARDING_ARGUMENT_VERSION).toBe(computeVersion());
  });

  it("is twelve hex characters", () => {
    expect(ONBOARDING_ARGUMENT_VERSION).toMatch(/^[0-9a-f]{12}$/);
  });

  // A bound value would make every copy its own cohort and group nothing.
  it("leaves every value unbound", () => {
    const withPlaceholders = Object.values(ARGUMENT_TEMPLATES).filter((template) => template.includes("<"));
    expect(withPlaceholders.length).toBeGreaterThan(0);
    expect(Object.values(ARGUMENT_TEMPLATES).join("")).not.toMatch(/https:\/\/docs\.copilotkit\.ai\/[a-z]/);
  });

  it("fills every placeholder it is given", () => {
    const filled = fillArgumentTemplate(ARGUMENT_TEMPLATES.framework, { name: "Mastra", slug: "mastra" });

    expect(filled).toBe(" I use the Mastra agent framework (`mastra`).");
    expect(filled).not.toContain("<");
  });

  it("speaks in the developer's voice, matching the base sentence", () => {
    for (const template of Object.values(ARGUMENT_TEMPLATES)) {
      expect(template).not.toMatch(/\bThe developer\b|\bThey \b|\bTheir\b/);
    }
  });
});
