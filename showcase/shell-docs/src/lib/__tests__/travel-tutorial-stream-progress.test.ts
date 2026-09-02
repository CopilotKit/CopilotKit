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
    "../../../../../examples/showcases/travel/lib/hooks/use-trips.tsx",
    import.meta.url,
  ),
  "utf8",
);

const activeToolCallGate =
  /render: \(\{ status \}\) =>\s+status === ["']executing["'] &&/;

describe("AI travel tutorial streamed progress", () => {
  it("documents that progress renders only for the active tool call", () => {
    expect(tripsHookSource).toMatch(activeToolCallGate);
    expect(stepFiveSource).toMatch(activeToolCallGate);
    expect(stepFiveSource).toContain(
      "The status check keeps completed tool calls from rendering newer progress state.",
    );
  });
});
