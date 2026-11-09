import {
  ChangeDetectionStrategy,
  Component,
  input,
  provideZonelessChangeDetection,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import {
  AbstractAgent,
  EventType,
  type AssistantMessage,
  type BaseEvent,
  type RunAgentInput,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { provideCopilotKit } from "./config";
import { CopilotKit } from "./copilotkit";
import { HumanInTheLoop } from "./human-in-the-loop";
import { HUMAN_IN_THE_LOOP_ABORTED_MESSAGE } from "./human-in-the-loop-abort";
import { RenderToolCalls } from "./render-tool-calls";
import type {
  HumanInTheLoopToolCall,
  HumanInTheLoopToolRenderer,
} from "./tools";

const TOOL_NAME = "book_call";
const TOOL_CALL_ID = "tool-call-1";

/** Records every `toolCall` value the renderer is given. */
const rendered: HumanInTheLoopToolCall[] = [];

/** HITL renderer that records each `toolCall` it is checked with. */
@Component({
  selector: "test-book-call",
  template: "{{ toolCall().status }}",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class BookCallRenderer implements HumanInTheLoopToolRenderer {
  readonly toolCall = input.required<HumanInTheLoopToolCall>();

  ngDoCheck(): void {
    rendered.push(this.toolCall());
  }
}

/** One run that asks for the HITL tool and finishes, leaving core to execute it. */
class ToolCallingAgent extends AbstractAgent {
  constructor() {
    super({ agentId: "default" });
  }

  run(runInput: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const events: BaseEvent[] = [
        {
          type: EventType.RUN_STARTED,
          threadId: runInput.threadId,
          runId: runInput.runId,
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_START,
          toolCallId: TOOL_CALL_ID,
          toolCallName: TOOL_NAME,
          parentMessageId: "assistant-1",
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: TOOL_CALL_ID,
          delta: JSON.stringify({ topic: "launch" }),
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_END,
          toolCallId: TOOL_CALL_ID,
        } as BaseEvent,
        {
          type: EventType.RUN_FINISHED,
          threadId: runInput.threadId,
          runId: runInput.runId,
        } as BaseEvent,
      ];
      events.forEach((event) => subscriber.next(event));
      subscriber.complete();
    });
  }
}

/**
 * Drives a real run through core: the agent calls the HITL tool, core parks
 * the Angular handler on the user, and `settle` either answers or stops the
 * run. The tool call is then rendered through `RenderToolCalls`, the path a
 * chat uses, so the props under test are the ones a user's component gets.
 */
async function renderSettledCall(
  settle: (copilotKit: CopilotKit, agent: AbstractAgent) => void,
): Promise<HumanInTheLoopToolCall> {
  const agent = new ToolCallingAgent();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideCopilotKit({
        licenseKey: "ck_pub_00000000000000000000000000000000",
        agents: { default: agent },
      }),
    ],
  });
  const copilotKit = TestBed.inject(CopilotKit);
  copilotKit.addHumanInTheLoop({
    name: TOOL_NAME,
    description: "Pick a time slot",
    parameters: z.object({ topic: z.string() }),
    component: BookCallRenderer,
  });

  const subscription = copilotKit.core.subscribe({
    onToolExecutionStart: () => {
      // Let the handler park on the user before settling the call.
      setTimeout(() => settle(copilotKit, agent));
    },
  });
  try {
    await copilotKit.core.runAgent({ agent });
  } finally {
    subscription.unsubscribe();
  }

  const assistant = agent.messages.find(
    (message): message is AssistantMessage =>
      message.role === "assistant" &&
      (message.toolCalls ?? []).some((call) => call.id === TOOL_CALL_ID),
  );
  expect(assistant).toBeDefined();
  expect(agent.messages.some((message) => message.role === "tool")).toBe(true);

  const fixture = TestBed.createComponent(RenderToolCalls);
  fixture.componentRef.setInput("message", assistant!);
  fixture.componentRef.setInput("messages", agent.messages);
  fixture.detectChanges();
  await fixture.whenStable();

  const last = rendered.at(-1);
  expect(last).toBeDefined();
  return last!;
}

describe("human-in-the-loop abort, through core and RenderToolCalls", () => {
  beforeEach(() => {
    rendered.length = 0;
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it("renders a request abandoned by a stop as aborted, with no result", async () => {
    const toolCall = await renderSettledCall((copilotKit, agent) =>
      copilotKit.core.stopAgent({ agent }),
    );

    expect(toolCall.status).toBe("complete");
    expect(toolCall.aborted).toBe(true);
    expect(toolCall.result).toBeUndefined();
    expect(toolCall.error).toBe(HUMAN_IN_THE_LOOP_ABORTED_MESSAGE);
    expect(typeof toolCall.respond).toBe("function");
  });

  it("renders the user's answer as the result, not aborted", async () => {
    const toolCall = await renderSettledCall(() =>
      TestBed.inject(HumanInTheLoop).addResult(
        TOOL_CALL_ID,
        TOOL_NAME,
        "Tue 14:00",
      ),
    );

    expect(toolCall.status).toBe("complete");
    expect(toolCall.aborted).toBeUndefined();
    expect(toolCall.error).toBeUndefined();
    expect(toolCall.result).toBe("Tue 14:00");
  });
});
