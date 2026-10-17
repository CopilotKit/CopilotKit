import type { AbstractAgent } from "@ag-ui/client";
import { describe, expect, it, vi } from "vitest";
import type { CopilotRuntimeLike } from "../../../core/runtime";
import {
  A2UI_MODE_FORWARDED_PROP,
  configureAgentForRequest,
} from "../agent-utils";

function fakeAgent() {
  const use = vi.fn();
  return { agent: { use } as unknown as AbstractAgent, use };
}

describe("configureAgentForRequest A2UI mode", () => {
  const runtime = { a2ui: { enabled: true } } as unknown as CopilotRuntimeLike;
  const request = new Request("http://localhost/run");

  it("applies the A2UI middleware in tool mode", () => {
    const { agent, use } = fakeAgent();
    configureAgentForRequest({
      runtime,
      request,
      agentId: "default",
      agent,
      providerA2UIHasCatalog: true,
    });
    expect(use).toHaveBeenCalledTimes(1);
  });

  it("skips the A2UI middleware entirely in markdown mode, even with runtime a2ui config", () => {
    const { agent, use } = fakeAgent();
    configureAgentForRequest({
      runtime,
      request,
      agentId: "default",
      agent,
      providerA2UIHasCatalog: false,
      providerA2UIMode: "markdown",
    });
    expect(use).not.toHaveBeenCalled();
  });

  it("exports the forwarded prop name", () => {
    expect(A2UI_MODE_FORWARDED_PROP).toBe("__copilotkitA2UIMode");
  });
});
