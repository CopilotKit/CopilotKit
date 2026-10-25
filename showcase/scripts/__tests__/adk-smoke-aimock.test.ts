import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import yaml from "yaml";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("ADK smoke provider isolation", () => {
  it.each([
    ["examples/integrations/adk/docker-compose.test.yml", "agent"],
    ["examples/integrations/docker-compose.production-image.yml", "app"],
  ])(
    "%s sends Gemini requests to aimock with a non-secret key",
    (path, service) => {
      const environment = yaml.parse(read(path)).services[service].environment;
      expect(environment).toContain(
        "GOOGLE_GEMINI_BASE_URL=http://aimock:4010",
      );
      expect(environment).toContain("GOOGLE_API_KEY=test-key-for-aimock");
      expect(environment).toContain("GOOGLE_GENAI_USE_VERTEXAI=false");
    },
  );

  it("does not inject the real Google provider secret into either smoke job", () => {
    const workflow = yaml.parse(
      read(".github/workflows/test_smoke-starter.yml"),
    );
    for (const job of ["smoke-starter", "smoke-starter-production-image"]) {
      for (const step of workflow.jobs[job].steps) {
        expect(step.env?.GOOGLE_API_KEY).toBeUndefined();
      }
    }
  });
});
