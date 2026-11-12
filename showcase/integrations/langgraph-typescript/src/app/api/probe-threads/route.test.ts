import { describe, expect, it } from "vitest";
import { cleanupProbeThreadRequest } from "../../../../_shared/ts/langgraph-probe-retention";
import { POST } from "./route";

// The harness releases each probe's LangGraph threads through this route after
// the full D4/D6 conversation. The TypeScript integration went without it for a
// month (the route landed only in the Python integrations in #7719), so every
// probe thread, run and checkpoint stayed in the agent's memory for the
// container's life. This pins the wiring so the route cannot silently vanish.
describe("probe-threads route", () => {
  it("exposes the shared LangGraph probe retention handler on POST", () => {
    expect(POST).toBe(cleanupProbeThreadRequest);
  });

  it("rejects a malformed cleanup body without contacting the agent", async () => {
    const response = await POST(
      new Request("http://localhost/api/probe-threads", {
        method: "POST",
        body: "null",
      }),
    );
    expect(response.status).toBe(400);
  });
});
