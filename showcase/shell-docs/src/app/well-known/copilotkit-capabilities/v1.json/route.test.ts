import { expect, test } from "vitest";
import { GET } from "./route";

test("publishes the versioned public AEO contract as JSON", async () => {
  const response = GET();
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(
    "application/json; charset=utf-8",
  );
  expect(body).toMatchObject({
    schemaVersion: 1,
    policyUrl: "https://docs.copilotkit.ai/aeo",
    canonicalHosts: {
      website: "https://www.copilotkit.ai",
      docs: "https://docs.copilotkit.ai",
      docsMcp: "https://mcp.copilotkit.ai",
    },
  });
  expect(body.surfaces.length).toBeGreaterThan(0);
});
