import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const quickstart = readFileSync(
  new URL(
    "../../content/docs/integrations/crewai-flows/quickstart.mdx",
    import.meta.url,
  ),
  "utf8",
);

describe("CrewAI Flows quickstart", () => {
  it("adapts a Flow to AG-UI before cloud registration", () => {
    const bridge = quickstart.indexOf("add_crewai_flow_fastapi_endpoint");
    const preflight = quickstart.indexOf("### Verify the AG-UI stream");
    const registration = quickstart.indexOf('Click "Add Remote Endpoint"');

    expect(bridge).toBeGreaterThan(-1);
    expect(preflight).toBeGreaterThan(bridge);
    expect(registration).toBeGreaterThan(preflight);
    expect(quickstart).not.toContain("fill in the details of your CrewAI Flow");
  });

  it("requires the AG-UI SSE lifecycle instead of accepting plain JSON", () => {
    expect(quickstart).toContain('"Accept: text/event-stream"');
    expect(quickstart).toContain("Content-Type: text/event-stream");
    expect(quickstart).toContain("RUN_STARTED");
    expect(quickstart).toContain("RUN_FINISHED");
    expect(quickstart).toContain("RUN_ERROR");
    expect(quickstart).toContain("normal JSON response");
  });
});
