import {
  ChangeDetectionStrategy,
  Component,
  input,
  provideZonelessChangeDetection,
} from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { TestBed } from "@angular/core/testing";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { Subagent } from "@copilotkit/core";
import { Subject } from "rxjs";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { provideCopilotKit } from "../../config";
import { provideCopilotChatConfiguration } from "../../chat-configuration";
import type { AngularToolCall } from "../../tools";
import { CopilotChat } from "./copilot-chat";

class StepwiseAgent extends AbstractAgent {
  readonly events = new Subject<BaseEvent>();

  run(_input: RunAgentInput) {
    return this.events.asObservable();
  }
}

@Component({
  selector: "test-tool-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [attr.data-testid]="'tool-' + toolCall().name">
      {{ toolCall().status }}:{{ toolCall().result ?? "" }}
    </div>
  `,
})
class ToolCard {
  readonly toolCall = input.required<AngularToolCall>();
}

@Component({
  selector: "test-custom-subagent",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      data-testid="custom-subagent"
      [attr.data-subagent-run-id]="subagentRunId()"
    >
      <h3>{{ subagent()?.name }}:{{ subagent()?.status }}</h3>
      @for (message of messages(); track message.id) {
        <p>{{ message.content }}</p>
      }
    </section>
  `,
})
class CustomSubagent {
  readonly subagentRunId = input.required<string>();
  readonly subagent = input<Subagent | undefined>();
  readonly messages = input<{ id: string; content?: unknown }[]>([]);
}

@Component({
  selector: "test-template-host",
  imports: [CopilotChat, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <copilot-chat threadId="thread-1" [subagentTemplate]="card" />
    <ng-template #card let-subagent let-body="body" let-bodyContext="bodyContext">
      <section data-testid="template-subagent">
        <h3>{{ subagent?.name }}:{{ subagent?.status }}</h3>
        <ng-container *ngTemplateOutlet="body; context: bodyContext" />
      </section>
    </ng-template>
  `,
})
class TemplateHost {}

function textStart(messageId: string, subagentRunId?: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_START,
    messageId,
    role: "assistant",
    subagentRunId,
  } as BaseEvent;
}

function say(messageId: string, text: string, subagentRunId?: string) {
  return [
    textStart(messageId, subagentRunId),
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text },
    { type: EventType.TEXT_MESSAGE_END, messageId },
  ] as BaseEvent[];
}

/** A supervisor tool call named after its id, so the test card can tell calls apart. */
function delegate(toolCallId: string, parentMessageId: string): BaseEvent[] {
  return [
    {
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName: toolCallId,
      parentMessageId,
    },
    { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: "{}" },
    { type: EventType.TOOL_CALL_END, toolCallId },
  ] as BaseEvent[];
}

function subagentStarted(subagentRunId: string, extra: object = {}): BaseEvent {
  return {
    type: EventType.SUBAGENT_STARTED,
    subagentRunId,
    name: `${subagentRunId}-agent`,
    ...extra,
  } as BaseEvent;
}

async function startChat(
  options: { customSubagent?: boolean; templateHost?: boolean } = {},
) {
  const agent = new StepwiseAgent({ agentId: "default" });
  TestBed.configureTestingModule({
    teardown: { destroyAfterEach: true },
    imports: [CopilotChat],
    providers: [
      provideZonelessChangeDetection(),
      provideCopilotKit({
        licenseKey: "ck_pub_00000000000000000000000000000000",
        agents: { default: agent },
        renderToolCalls: [{ name: "*", args: z.any(), component: ToolCard }],
      }),
      provideCopilotChatConfiguration(),
    ],
  });
  // The chat and the run must agree on the thread the subagents are tracked under.
  const threadId = "thread-1";
  agent.threadId = threadId;
  const fixture = options.templateHost
    ? TestBed.createComponent(TemplateHost)
    : TestBed.createComponent(CopilotChat);
  if (!options.templateHost) {
    fixture.componentRef.setInput("threadId", threadId);
  }
  if (options.customSubagent) {
    fixture.componentRef.setInput("subagentComponent", CustomSubagent);
  }
  fixture.detectChanges();
  await fixture.whenStable();

  void agent.runAgent({ runId: "run-1" }).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const emit = async (...events: BaseEvent[]) => {
    for (const event of events) agent.events.next(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  await emit({
    type: EventType.RUN_STARTED,
    threadId,
    runId: "run-1",
  } as BaseEvent);
  const root = fixture.nativeElement as HTMLElement;
  return { emit, root, threadId };
}

function group(root: HTMLElement, subagentRunId: string) {
  const element = root.querySelector(
    `[data-subagent-run-id="${subagentRunId}"]`,
  );
  if (!(element instanceof HTMLElement)) {
    throw new Error(`no group for ${subagentRunId}`);
  }
  return element;
}

function header(root: HTMLElement, subagentRunId: string) {
  return group(root, subagentRunId).querySelector("button")!;
}

function textIn(element: Element, text: string) {
  return [...element.querySelectorAll("*")].some(
    (node) => node.children.length === 0 && node.textContent?.trim() === text,
  );
}

function isHidden(element: Element) {
  return element.closest("[hidden]") !== null;
}

function elementWithText(root: HTMLElement, text: string) {
  return [...root.querySelectorAll("*")].find(
    (node) => node.children.length === 0 && node.textContent?.trim() === text,
  )!;
}

describe("CopilotChat subagent groups", () => {
  // jsdom has no scrolling; the chat scrolls to the bottom as messages arrive.
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: () => undefined,
    });
  });
  afterEach(() => TestBed.resetTestingModule());

  it("puts two parallel subagents right after the tool calls that started them", async () => {
    const { emit, root } = await startChat();
    await emit(
      ...say("supervisor", "Delegating now"),
      ...delegate("call-1", "supervisor"),
      ...delegate("call-2", "supervisor"),
      subagentStarted("research", {
        name: "researcher",
        parentToolCallId: "call-1",
      }),
      subagentStarted("write", { name: "writer", parentToolCallId: "call-2" }),
      textStart("r1", "research"),
      ...say("w1", "Drafting intro", "write"),
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "r1",
        delta: "Found 3 ",
      } as BaseEvent,
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "r1",
        delta: "sources",
      } as BaseEvent,
      { type: EventType.TEXT_MESSAGE_END, messageId: "r1" } as BaseEvent,
    );

    expect(textIn(group(root, "research"), "Found 3 sources")).toBe(true);
    expect(textIn(group(root, "write"), "Drafting intro")).toBe(true);
    expect(textIn(group(root, "research"), "Drafting intro")).toBe(false);
    const card1 = root.querySelector('[data-testid="tool-call-1"]')!;
    const card2 = root.querySelector('[data-testid="tool-call-2"]')!;
    expect(
      card1.compareDocumentPosition(group(root, "research")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      group(root, "research").compareDocumentPosition(card2) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(textIn(group(root, "research"), "researcher")).toBe(true);
  });

  it("starts every group collapsed, whatever its status, and keeps a group the user opened open", async () => {
    const { emit, root } = await startChat();
    await emit(
      ...say("supervisor", "Delegating now"),
      ...delegate("call-1", "supervisor"),
      ...delegate("call-2", "supervisor"),
      ...delegate("call-3", "supervisor"),
      subagentStarted("done", { parentToolCallId: "call-1" }),
      subagentStarted("failed", { parentToolCallId: "call-2" }),
      subagentStarted("waiting", { parentToolCallId: "call-3" }),
      ...say("d1", "Done text", "done"),
    );
    expect(header(root, "done").getAttribute("aria-expanded")).toBe("false");
    expect(isHidden(elementWithText(root, "Done text"))).toBe(true);

    header(root, "done").click();
    await emit();
    expect(header(root, "done").getAttribute("aria-expanded")).toBe("true");
    expect(isHidden(elementWithText(root, "Done text"))).toBe(false);

    await emit(
      { type: EventType.SUBAGENT_FINISHED, subagentRunId: "done" } as BaseEvent,
      {
        type: EventType.SUBAGENT_ERROR,
        subagentRunId: "failed",
        message: "Search timed out",
      } as BaseEvent,
      {
        type: EventType.SUBAGENT_FINISHED,
        subagentRunId: "waiting",
        outcome: { type: "suspended" },
      } as BaseEvent,
    );

    expect(group(root, "done").dataset["status"]).toBe("done");
    expect(header(root, "done").getAttribute("aria-expanded")).toBe("true");
    expect(header(root, "failed").getAttribute("aria-expanded")).toBe("false");
    expect(header(root, "waiting").getAttribute("aria-expanded")).toBe("false");
    expect(textIn(header(root, "failed"), "Failed")).toBe(true);
    expect(textIn(group(root, "failed"), "Search timed out")).toBe(true);
  });

  it("nests a child under its parent group, and groups unannounced output at its position", async () => {
    const { emit, root } = await startChat();
    await emit(
      ...say("supervisor", "Delegating now"),
      ...delegate("call-1", "supervisor"),
      subagentStarted("research", { parentToolCallId: "call-1" }),
      subagentStarted("notes", { parentSubagentRunId: "research" }),
      ...say("n1", "Taking notes", "notes"),
      ...say("x1", "Mystery work", "unannounced"),
    );

    expect(textIn(group(root, "notes"), "Taking notes")).toBe(true);
    expect(group(root, "research").contains(group(root, "notes"))).toBe(true);
    expect(textIn(group(root, "unannounced"), "Subagent")).toBe(true);
    expect(textIn(group(root, "unannounced"), "Mystery work")).toBe(true);
  });

  it("pairs a tool result attributed to a subagent with the parent's tool card", async () => {
    const { emit, root } = await startChat();
    await emit(
      ...say("supervisor", "Delegating now"),
      ...delegate("call-1", "supervisor"),
      subagentStarted("research", { parentToolCallId: "call-1" }),
      {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "call-1",
        messageId: "result-1",
        role: "tool",
        content: "3 sources",
        subagentRunId: "research",
      } as BaseEvent,
    );

    // The card template may be reformatted across lines; compare the text only.
    expect(
      root.querySelector('[data-testid="tool-call-1"]')?.textContent?.trim(),
    ).toBe("complete:3 sources");
  });

  it("renders a custom subagent slot with the group's messages inside", async () => {
    const { emit, root } = await startChat({ customSubagent: true });
    await emit(
      ...say("supervisor", "Delegating now"),
      ...delegate("call-1", "supervisor"),
      subagentStarted("research", {
        name: "researcher",
        parentToolCallId: "call-1",
      }),
      ...say("r1", "Found sources", "research"),
    );

    const custom = root.querySelector('[data-testid="custom-subagent"]')!;
    expect(textIn(custom, "researcher:running")).toBe(true);
    expect(textIn(custom, "Found sources")).toBe(true);
  });

  it("renders an unattributed run exactly as before, with no groups", async () => {
    const { emit, root, threadId } = await startChat();
    await emit(
      ...say("supervisor", "Plain answer"),
      ...delegate("call-1", "supervisor"),
      { type: EventType.RUN_FINISHED, threadId, runId: "run-1" } as BaseEvent,
    );

    expect(textIn(root, "Plain answer")).toBe(true);
    expect(root.querySelector("[data-subagent-run-id]")).toBeNull();
    expect(root.querySelector('[data-testid="tool-call-1"]')).not.toBeNull();
  });

  describe("Angular-specific semantics", () => {
    it("renders a subagent template that places the default group body", async () => {
      const { emit, root } = await startChat({ templateHost: true });
      await emit(
        ...say("supervisor", "Delegating now"),
        ...delegate("call-1", "supervisor"),
        subagentStarted("research", {
          name: "researcher",
          parentToolCallId: "call-1",
        }),
        ...say("r1", "Found sources", "research"),
      );

      const custom = root.querySelector('[data-testid="template-subagent"]')!;
      expect(textIn(custom, "researcher:running")).toBe(true);
      expect(textIn(custom, "Found sources")).toBe(true);
    });
  });
});
