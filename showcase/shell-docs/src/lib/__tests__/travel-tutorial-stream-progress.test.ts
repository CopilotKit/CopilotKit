import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stepFiveSource = readFileSync(
  new URL(
    "../../content/docs/integrations/langgraph/tutorials/ai-travel-app/step-5-stream-progress.mdx",
    import.meta.url,
  ),
  "utf8",
);

const tripsHookSource = readFileSync(
  new URL(
    "../../../../../examples/v1/travel/lib/hooks/use-trips.tsx",
    import.meta.url,
  ),
  "utf8",
);

const searchAgentSource = readFileSync(
  new URL(
    "../../../../../examples/v1/travel/agent/src/search.py",
    import.meta.url,
  ),
  "utf8",
);

const activeToolCallGate =
  /render: \(\{ status \}\) =>\s+status === ["']executing["'] &&/;
const asyncPlacesSearch =
  /async with httpx\.AsyncClient\(\) as client:\s+for i, query in enumerate\(queries\):\s+places\.extend\(await _search_places\(client, query, i\)\)/;

describe("AI travel tutorial streamed progress", () => {
  it("documents that progress renders only for the active tool call", () => {
    expect(tripsHookSource).toMatch(activeToolCallGate);
    expect(stepFiveSource).toMatch(activeToolCallGate);
    expect(stepFiveSource).toContain(
      "The status check keeps completed tool calls from rendering newer progress state.",
    );
  });

  it("documents the async Places client used by the search agent", () => {
    expect(searchAgentSource).toMatch(asyncPlacesSearch);
    expect(stepFiveSource).toMatch(asyncPlacesSearch);
  });
});
