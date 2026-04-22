import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { EMPTY, Observable } from "rxjs";
import { type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotChat } from "../CopilotChat";

describe("CopilotChat avoids /connect for locally-generated threadIds (ENT-314)", () => {
  function buildAgentWithConnectSpy(): {
    agent: MockStepwiseAgent;
    connectSpy: ReturnType<typeof vi.fn>;
  } {
    const connectSpy = vi.fn();
    class SpyAgent extends MockStepwiseAgent {
      connect(input: RunAgentInput): Observable<BaseEvent> {
        connectSpy(input);
        return EMPTY;
      }
    }
    return { agent: new SpyAgent(), connectSpy };
  }

  it("does not call connect() when no threadId is supplied", async () => {
    const { agent, connectSpy } = buildAgentWithConnectSpy();

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChat welcomeScreen={false} />
      </CopilotKitProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("calls connect() when a threadId is supplied via props", async () => {
    const { agent, connectSpy } = buildAgentWithConnectSpy();

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChat welcomeScreen={false} threadId="user-thread-abc" />
      </CopilotKitProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connectSpy).toHaveBeenCalled();
  });

  it("calls connect() when a threadId is supplied via configuration provider", async () => {
    const { agent, connectSpy } = buildAgentWithConnectSpy();

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChatConfigurationProvider threadId="config-thread-xyz">
          <CopilotChat welcomeScreen={false} />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connectSpy).toHaveBeenCalled();
  });
});
