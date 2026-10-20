import { expect, test } from "vitest";
import { normalizeModel } from "./model-selector";

test.each(["openai", "anthropic", "google_genai"])(
  "keeps the supported %s model",
  (model) => {
    expect(normalizeModel(model)).toBe(model);
  },
);

test.each([null, "", "crewai", "unknown"])(
  "falls back to openai for %s",
  (model) => {
    expect(normalizeModel(model)).toBe("openai");
  },
);
