import {
  EnvironmentInjector,
  runInInjectionContext,
  signal,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import type { Message } from "@ag-ui/core";
import {
  CopilotChatReasoningMessage,
  CopilotChatReasoningMessageHeader,
  CopilotChatReasoningMessageContent,
  formatReasoningDuration,
} from "../copilot-chat-reasoning-message";
import type { ReasoningMessage } from "../copilot-chat-reasoning-message.types";

const reasoningId = "reasoning-1";

function makeReasoning(content = ""): ReasoningMessage {
  return {
    id: reasoningId,
    role: "reasoning",
    content,
  } as ReasoningMessage;
}

interface Bindings {
  message: ReturnType<typeof signal<ReasoningMessage>>;
  messages: ReturnType<typeof signal<Message[]>>;
  isRunning: ReturnType<typeof signal<boolean>>;
}

function buildComponent(initial: {
  message: ReasoningMessage;
  messages?: Message[];
  isRunning?: boolean;
}): { component: CopilotChatReasoningMessage; bindings: Bindings } {
  const injector = TestBed.inject(EnvironmentInjector);
  const component = runInInjectionContext(
    injector,
    () => new CopilotChatReasoningMessage(),
  );

  const bindings: Bindings = {
    message: signal(initial.message),
    messages: signal(initial.messages ?? [initial.message]),
    isRunning: signal(initial.isRunning ?? false),
  };

  (component as unknown as { message: () => ReasoningMessage }).message = () =>
    bindings.message();
  (component as unknown as { messages: () => Message[] }).messages = () =>
    bindings.messages();
  (component as unknown as { isRunning: () => boolean }).isRunning = () =>
    bindings.isRunning();

  return { component, bindings };
}

describe("formatReasoningDuration", () => {
  it("formats sub-second durations as 'a few seconds'", () => {
    expect(formatReasoningDuration(0)).toBe("a few seconds");
    expect(formatReasoningDuration(0.5)).toBe("a few seconds");
  });

  it("formats sub-minute durations in seconds", () => {
    expect(formatReasoningDuration(1)).toBe("1 seconds");
    expect(formatReasoningDuration(45)).toBe("45 seconds");
  });

  it("formats whole-minute durations as N minute(s)", () => {
    expect(formatReasoningDuration(60)).toBe("1 minute");
    expect(formatReasoningDuration(120)).toBe("2 minutes");
  });

  it("formats mixed minute+second durations as Nm Ms", () => {
    expect(formatReasoningDuration(75)).toBe("1m 15s");
    expect(formatReasoningDuration(125)).toBe("2m 5s");
  });
});

describe("CopilotChatReasoningMessage", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  it("isStreaming is true only when running and latest", () => {
    const message = makeReasoning("hi");
    const { component, bindings } = buildComponent({
      message,
      isRunning: true,
    });

    expect(component.isStreaming()).toBe(true);

    const later: Message = {
      id: "assistant-2",
      role: "assistant",
      content: "answer",
    } as Message;
    bindings.messages.set([message, later]);
    expect(component.isStreaming()).toBe(false);

    bindings.messages.set([message]);
    bindings.isRunning.set(false);
    expect(component.isStreaming()).toBe(false);
  });

  it("shows 'Thinking…' label while streaming", () => {
    const { component } = buildComponent({
      message: makeReasoning(""),
      isRunning: true,
    });
    expect(component.isStreaming()).toBe(true);
    expect(component.label()).toBe("Thinking…");
  });

  it("shows 'Thought for X seconds' label after streaming ends", () => {
    const message = makeReasoning("Some thought");
    const { component, bindings } = buildComponent({
      message,
      isRunning: true,
    });

    bindings.isRunning.set(false);
    component.onStreamingChange();

    expect(component.isStreaming()).toBe(false);
    expect(component.label()).toMatch(/^Thought for /);
  });

  it("auto-opens when streaming starts", () => {
    const message = makeReasoning("partial...");
    const { component, bindings } = buildComponent({
      message,
      isRunning: false,
    });
    expect(component.isOpen()).toBe(false);

    bindings.isRunning.set(true);
    component.onStreamingChange();
    expect(component.isOpen()).toBe(true);
  });

  it("auto-collapses when streaming ends without manual interaction", () => {
    const message = makeReasoning("done");
    const { component, bindings } = buildComponent({
      message,
      isRunning: true,
    });
    component.onStreamingChange();
    expect(component.isOpen()).toBe(true);

    bindings.isRunning.set(false);
    component.onStreamingChange();
    expect(component.isOpen()).toBe(false);
  });

  it("manual toggle overrides auto-collapse when streaming ends", () => {
    const message = makeReasoning("manual session");
    const { component, bindings } = buildComponent({
      message,
      isRunning: true,
    });
    component.onStreamingChange();
    expect(component.isOpen()).toBe(true);

    component.toggle();
    expect(component.isOpen()).toBe(false);
    component.toggle();
    expect(component.isOpen()).toBe(true);

    bindings.isRunning.set(false);
    component.onStreamingChange();
    expect(component.isOpen()).toBe(true);
  });

  it("manual-toggle flag resets when streaming restarts", () => {
    const message = makeReasoning("first session");
    const { component, bindings } = buildComponent({
      message,
      isRunning: true,
    });
    component.onStreamingChange();
    component.toggle();
    bindings.isRunning.set(false);
    component.onStreamingChange();
    expect(component.isOpen()).toBe(false);

    bindings.isRunning.set(true);
    component.onStreamingChange();
    expect(component.isOpen()).toBe(true);

    bindings.isRunning.set(false);
    component.onStreamingChange();
    expect(component.isOpen()).toBe(false);
  });

  it("ignores toggle calls when there is no content", () => {
    const { component } = buildComponent({
      message: makeReasoning(""),
      isRunning: false,
    });
    expect(component.handleToggle()).toBeUndefined();
    component.toggle();
    expect(component.isOpen()).toBe(false);
  });

  it("provides slot context computed values while streaming", () => {
    const message = makeReasoning("hello");
    const { component } = buildComponent({ message, isRunning: true });
    component.onStreamingChange();

    const headerCtx = component.headerContext();
    expect(headerCtx.label).toBe("Thinking…");
    expect(headerCtx.hasContent).toBe(true);
    expect(headerCtx.isStreaming).toBe(true);
    expect(typeof headerCtx.onClick).toBe("function");

    const contentCtx = component.contentContext();
    expect(contentCtx.content).toBe("hello");
    expect(contentCtx.hasContent).toBe(true);
    expect(contentCtx.isStreaming).toBe(true);

    const toggleCtx = component.toggleContext();
    expect(toggleCtx.isOpen).toBe(true);
  });
});

describe("CopilotChatReasoningMessageHeader", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  function buildHeader(initial: {
    isOpen?: boolean;
    label?: string;
    hasContent?: boolean;
    isStreaming?: boolean;
    clickHandler?: () => void;
  }): CopilotChatReasoningMessageHeader {
    const injector = TestBed.inject(EnvironmentInjector);
    const header = runInInjectionContext(
      injector,
      () => new CopilotChatReasoningMessageHeader(),
    );
    (header as unknown as { isOpen: () => boolean }).isOpen = () =>
      initial.isOpen ?? false;
    (header as unknown as { label: () => string }).label = () =>
      initial.label ?? "Thoughts";
    (header as unknown as { hasContent: () => boolean }).hasContent = () =>
      initial.hasContent ?? false;
    (header as unknown as { isStreaming: () => boolean }).isStreaming = () =>
      initial.isStreaming ?? false;
    (
      header as unknown as { clickHandler: () => (() => void) | undefined }
    ).clickHandler = () => initial.clickHandler;
    return header;
  }

  it("returns the provided label via signal", () => {
    const header = buildHeader({ label: "Thinking…" });
    expect(header.label()).toBe("Thinking…");
  });

  it("isExpandable matches hasContent", () => {
    expect(buildHeader({ hasContent: false }).isExpandable()).toBe(false);
    expect(buildHeader({ hasContent: true }).isExpandable()).toBe(true);
  });

  it("invokes provided clickHandler when handleClick is called", () => {
    let count = 0;
    const header = buildHeader({
      hasContent: true,
      clickHandler: () => {
        count += 1;
      },
    });
    header.handleClick();
    expect(count).toBe(1);
  });

  it("does nothing when handleClick is called without a clickHandler", () => {
    const header = buildHeader({ hasContent: false });
    expect(() => header.handleClick()).not.toThrow();
  });

  it("computes chevronClass with rotate-90 when open", () => {
    const open = buildHeader({ isOpen: true, hasContent: true });
    expect(open.chevronClass()).toContain("rotate-90");
    const closed = buildHeader({ isOpen: false, hasContent: true });
    expect(closed.chevronClass()).not.toContain("rotate-90");
  });
});

describe("CopilotChatReasoningMessageContent", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  function buildContent(initial: {
    isStreaming?: boolean;
    hasContent?: boolean;
    content?: string;
  }): CopilotChatReasoningMessageContent {
    const injector = TestBed.inject(EnvironmentInjector);
    const content = runInInjectionContext(
      injector,
      () => new CopilotChatReasoningMessageContent(),
    );
    (content as unknown as { isStreaming: () => boolean }).isStreaming = () =>
      initial.isStreaming ?? false;
    (content as unknown as { hasContent: () => boolean }).hasContent = () =>
      initial.hasContent ?? false;
    (content as unknown as { content: () => string }).content = () =>
      initial.content ?? "";
    return content;
  }

  it("shouldRender is false when no content and not streaming", () => {
    expect(
      buildContent({ hasContent: false, isStreaming: false }).shouldRender(),
    ).toBe(false);
  });

  it("shouldRender is true when streaming even without content", () => {
    expect(
      buildContent({ hasContent: false, isStreaming: true }).shouldRender(),
    ).toBe(true);
  });

  it("shouldRender is true when content exists even when not streaming", () => {
    expect(
      buildContent({
        hasContent: true,
        isStreaming: false,
        content: "abc",
      }).shouldRender(),
    ).toBe(true);
  });
});
