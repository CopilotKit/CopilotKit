import React from "react";
import { describe, it, expect, vi } from "vitest";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
} from "../../../__tests__/utils/test-helpers";
import { CopilotChat } from "../CopilotChat";
import { CopilotKitCoreErrorCode } from "@copilotkit/core";
import { type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { Observable, EMPTY } from "rxjs";

/**
 * Mock agent whose connect() always fails
 */
class FailingConnectAgent extends MockStepwiseAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    return super.run(input);
  }

  connect(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      subscriber.error(new Error("connect failed"));
    });
  }
}

/**
 * Mock agent whose connect() succeeds (returns empty observable)
 */
class HealthyConnectAgent extends MockStepwiseAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    return super.run(input);
  }

  connect(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }
}

describe("CopilotChat onError", () => {
  it("connectAgent failure fires onError on CopilotChat and does not crash", async () => {
    const agent = new FailingConnectAgent();
    const chatOnError = vi.fn();

    renderWithCopilotKit({
      agent,
      children: <CopilotChat welcomeScreen={false} onError={chatOnError} />,
    });

    // Wait for the connectAgent error to propagate
    await vi.waitFor(() => {
      expect(chatOnError).toHaveBeenCalled();
    });

    // Check that AGENT_CONNECT_FAILED is among the errors
    const allCodes = chatOnError.mock.calls.map((c: any) => c[0].code);
    expect(allCodes).toContain(CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED);
  });

  it("onError on CopilotChat does not fire for a healthy agent", async () => {
    const agent = new HealthyConnectAgent();
    const chatOnError = vi.fn();

    renderWithCopilotKit({
      agent,
      children: <CopilotChat welcomeScreen={false} onError={chatOnError} />,
    });

    // No errors should fire for a healthy agent
    await new Promise((r) => setTimeout(r, 50));
    expect(chatOnError).not.toHaveBeenCalled();
  });
});
