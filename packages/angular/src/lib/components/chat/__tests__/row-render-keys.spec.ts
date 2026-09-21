import { ApplicationRef, Component, input } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import type { AssistantMessage, Message, ToolCall } from "@ag-ui/core";
import { CopilotChatMessageView } from "../copilot-chat-message-view";
import { CopilotKit } from "../../../copilotkit";

/**
 * The key algorithm is tested in @copilotkit/shared. What belongs here is the
 * wiring: that `@for` tracks by the resolved key, and that anchors are recorded
 * from `afterRenderEffect` rather than while the computed evaluates.
 *
 * `fixture.detectChanges()` alone does not run `afterRenderEffect` — it runs on
 * an `ApplicationRef` render cycle, which is what a real application performs
 * and what `tick()` performs here. A test that omits it sees no anchors at all.
 */

function toolCall(id: string): ToolCall {
  return {
    id,
    type: "function",
    function: { name: "approve", arguments: "{}" },
  };
}

function assistant(id: string, toolCalls?: ToolCall[]): Message {
  return { id, role: "assistant", content: "…", toolCalls } as AssistantMessage;
}

@Component({
  standalone: true,
  template: `
    <div data-testid="row">{{ message().id }}</div>
  `,
})
class StubAssistantMessage {
  readonly message = input.required<AssistantMessage>();
}

/** Renders one snapshot, then another, and reports the track key for each. */
function keysAcrossRekey(toolCalls?: ToolCall[]) {
  const fixture = TestBed.createComponent(CopilotChatMessageView);
  const app = TestBed.inject(ApplicationRef);
  fixture.componentRef.setInput(
    "assistantMessageComponent",
    StubAssistantMessage,
  );

  const streaming = assistant("lc_run--1", toolCalls);
  fixture.componentRef.setInput("messages", [streaming]);
  fixture.detectChanges();
  app.tick();
  const before = fixture.componentInstance.rowRenderKey(0, streaming);

  const renamed = assistant("resp_1", toolCalls);
  fixture.componentRef.setInput("messages", [renamed]);
  fixture.detectChanges();
  app.tick();

  return { before, after: fixture.componentInstance.rowRenderKey(0, renamed) };
}

describe("CopilotChatMessageView row keys", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CopilotKit,
          useValue: {
            activityMessageRenderConfigs: () => [],
            toolCallRenderConfigs: () => [],
            getAgent: () => undefined,
          },
        },
      ],
    });
  });

  it("holds the row key when the snapshot re-keys a message carrying a tool call", () => {
    const { before, after } = keysAcrossRekey([toolCall("call_A")]);

    expect(before).toBe("lc_run--1");
    expect(after).toBe("lc_run--1");
  });

  it("still re-keys a text-only message (documented limitation)", () => {
    const { before, after } = keysAcrossRekey();

    expect(before).toBe("lc_run--1");
    expect(after).toBe("resp_1");
  });
});
