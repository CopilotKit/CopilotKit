import { describe, it, expect, vi } from "vitest";
import { defineComponent } from "vue";
import { CopilotKitCoreErrorCode } from "@copilotkit/core";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable, EMPTY } from "rxjs";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
} from "../../../__tests__/utils/test-helpers";
import CopilotChat from "../CopilotChat.vue";

/**
 * Mock agent whose connect() always fails
 */
class FailingConnectAgent extends MockStepwiseAgent {
  override run(input: RunAgentInput): Observable<BaseEvent> {
    return super.run(input);
  }

  override connect(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      subscriber.error(new Error("connect failed"));
    });
  }
}

/**
 * Mock agent whose connect() succeeds (returns empty observable)
 */
class HealthyConnectAgent extends MockStepwiseAgent {
  override run(input: RunAgentInput): Observable<BaseEvent> {
    return super.run(input);
  }

  override connect(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }
}

function createHost(chatOnError: (event: unknown) => void) {
  return defineComponent({
    components: { CopilotChat },
    setup() {
      return { chatOnError };
    },
    template: `
      <CopilotChat :welcome-screen="false" :on-error="chatOnError" />
    `,
  });
}

describe("CopilotChat onError", () => {
  it("connectAgent failure fires onError on CopilotChat and does not crash", async () => {
    const agent = new FailingConnectAgent();
    const chatOnError = vi.fn();

    renderWithCopilotKit({
      agent,
      children: createHost(chatOnError),
    });

    // Wait for the connectAgent error to propagate
    await vi.waitFor(() => {
      expect(chatOnError).toHaveBeenCalled();
    });

    // Check that AGENT_CONNECT_FAILED is among the errors
    const allCodes = chatOnError.mock.calls.map((call) => call[0].code);
    expect(allCodes).toContain(CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED);
  });

  it("onError on CopilotChat does not fire for a healthy agent", async () => {
    const agent = new HealthyConnectAgent();
    const chatOnError = vi.fn();

    renderWithCopilotKit({
      agent,
      children: createHost(chatOnError),
    });

    // No errors should fire for a healthy agent
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chatOnError).not.toHaveBeenCalled();
  });
});
