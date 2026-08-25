import { afterEach, describe, expect, it } from "vitest";

import {
  EVENT_SNIPPETS_STORAGE_KEY,
  compileActivityRecipe,
  compileChatSnippet,
  compileFromActivityMessage,
  expandSnippetEventsForRun,
  groupEventSnippets,
  recipeIconName,
  recipeIconWrapClass,
  snippetJsonIsRunnable,
  compileReasoningRecipe,
  compileTextRecipe,
  compileToolCallRecipe,
  deleteEventSnippet,
  ensureRunEnvelope,
  exportEventSnippetsJson,
  importEventSnippets,
  loadEventSnippets,
  parseSnippetEvents,
  editorStateFromSnippet,
  recipeDraftFromEvents,
  snippetArgsJson,
  snippetContainsToolCall,
  upsertEventSnippet,
} from "../event-snippets.js";
import type { EventSnippet, SnippetEvent } from "../event-snippets.js";

const THREAD_ID = "thread-1";
const RUN_ID = "run-1";

function memoryStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem(key: string) {
      return store[key] ?? null;
    },
    setItem(key: string, value: string) {
      store[key] = value;
    },
    dump() {
      return store;
    },
  };
}

function typesOf(events: ReadonlyArray<SnippetEvent>) {
  return events.map((event) => event.type);
}

describe("event snippet recipes", () => {
  it("compiles a tool call without RESULT and wraps the run", () => {
    const events = compileToolCallRecipe({
      toolName: "get_weather",
      argsJson: '{"city":"Berlin"}',
      threadId: THREAD_ID,
      runId: RUN_ID,
      parentMessageId: "msg-1",
      toolCallId: "call-1",
    });

    expect(typesOf(events)).toEqual([
      "RUN_STARTED",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "RUN_FINISHED",
    ]);
    expect(snippetContainsToolCall(events)).toBe(true);
  });

  it("rejects an empty tool name and invalid args JSON", () => {
    expect(() =>
      compileToolCallRecipe({
        toolName: "  ",
        argsJson: "{}",
        threadId: THREAD_ID,
        runId: RUN_ID,
      }),
    ).toThrow("Tool name is required.");
    expect(() =>
      compileToolCallRecipe({
        toolName: "get_weather",
        argsJson: "{",
        threadId: THREAD_ID,
        runId: RUN_ID,
      }),
    ).toThrow("Tool args JSON is invalid.");
    const emptyArgs = compileToolCallRecipe({
      toolName: "sayHello",
      argsJson: "  ",
      threadId: THREAD_ID,
      runId: RUN_ID,
    });
    const argsEvent = emptyArgs.find(
      (event) => event.type === "TOOL_CALL_ARGS",
    );
    expect(argsEvent?.delta).toBe("{}");
    expect(snippetArgsJson({ name: "Alem" })).toBe('{"name":"Alem"}');
    expect(snippetArgsJson('{"name":"Alem"}{"name":"Alem"}')).toBe(
      '{"name":"Alem"}',
    );
    const fromObject = compileToolCallRecipe({
      toolName: "sayHello",
      argsJson: { name: "Alem" },
      threadId: THREAD_ID,
      runId: RUN_ID,
    });
    expect(
      fromObject.find((event) => event.type === "TOOL_CALL_ARGS")?.delta,
    ).toBe('{"name":"Alem"}');
  });

  it("rejects truncated tool args fast instead of scanning every prefix", () => {
    // A streaming tool call. No prefix ever parses, so the old recovery loop
    // walked the whole string once per character.
    const truncated = `{"html":"${"a".repeat(200_000)}`;
    const started = performance.now();
    expect(() => snippetArgsJson(truncated)).toThrow(
      "Tool args JSON is invalid.",
    );
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("still recovers the first object when text follows it", () => {
    expect(snippetArgsJson('{"a":{"b":"}"}} trailing junk')).toBe(
      '{"a":{"b":"}"}}',
    );
    expect(snippetArgsJson('{"a":"\\""} tail')).toBe('{"a":"\\""}');
  });

  it("compiles reasoning, text, and activity recipes", () => {
    expect(
      typesOf(
        compileReasoningRecipe({
          text: "Checking the schema",
          threadId: THREAD_ID,
          runId: RUN_ID,
        }),
      ),
    ).toEqual([
      "RUN_STARTED",
      "REASONING_START",
      "REASONING_MESSAGE_START",
      "REASONING_MESSAGE_CONTENT",
      "REASONING_MESSAGE_END",
      "REASONING_END",
      "RUN_FINISHED",
    ]);
    expect(
      typesOf(
        compileTextRecipe({
          text: "Hello",
          threadId: THREAD_ID,
          runId: RUN_ID,
          messageId: "msg-text",
        }),
      ),
    ).toEqual([
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "RUN_FINISHED",
    ]);
    const activity = compileActivityRecipe({
      activityType: "a2ui-surface",
      contentJson: '{"a2ui_operations":[]}',
      threadId: THREAD_ID,
      runId: RUN_ID,
      messageId: "msg-a2ui",
    });
    expect(typesOf(activity)).toEqual([
      "RUN_STARTED",
      "ACTIVITY_SNAPSHOT",
      "RUN_FINISHED",
    ]);
    expect(snippetContainsToolCall(activity)).toBe(false);
  });

  it("does not add a second run envelope when one is already present", () => {
    const events = ensureRunEnvelope(
      [
        { type: "RUN_STARTED", threadId: THREAD_ID, runId: RUN_ID },
        { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" },
        { type: "RUN_FINISHED", threadId: THREAD_ID, runId: RUN_ID },
      ],
      { threadId: THREAD_ID, runId: RUN_ID },
    );
    expect(typesOf(events)).toEqual([
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "RUN_FINISHED",
    ]);
  });
});

describe("event snippet capture", () => {
  it("saves text, reasoning, and tool-call captures as their own recipes", () => {
    const text = compileChatSnippet({
      kind: "text",
      messageId: "asst-1",
      content: "Looking that up",
      threadId: THREAD_ID,
      runId: RUN_ID,
    });
    expect(text.recipe).toBe("text");
    expect(text.name).toContain("Looking that up");
    expect(typesOf(text.events)).toEqual([
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "RUN_FINISHED",
    ]);

    const reasoning = compileChatSnippet({
      kind: "reasoning",
      messageId: "think-1",
      content: "I should check the weather",
      threadId: THREAD_ID,
      runId: RUN_ID,
    });
    expect(reasoning.recipe).toBe("reasoning");
    expect(typesOf(reasoning.events)).toContain("REASONING_MESSAGE_CONTENT");

    const tool = compileChatSnippet({
      kind: "tool-call",
      messageId: "asst-1",
      toolCallId: "call-1",
      toolName: "get_weather",
      argsJson: '{"city":"Oslo"}',
      threadId: THREAD_ID,
      runId: RUN_ID,
    });
    expect(tool.recipe).toBe("tool-call");
    expect(typesOf(tool.events)).toEqual([
      "RUN_STARTED",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "RUN_FINISHED",
    ]);
    expect(tool.events.some((event) => event.type === "TOOL_CALL_RESULT")).toBe(
      false,
    );
  });

  it("fills recipe fields from saved events", () => {
    const tool = compileChatSnippet({
      kind: "tool-call",
      messageId: "asst-1",
      toolCallId: "call-1",
      toolName: "sayHello",
      argsJson: '{"name":"Alem"}',
      threadId: THREAD_ID,
      runId: RUN_ID,
    });
    const draft = recipeDraftFromEvents(tool.events);
    expect(draft.toolName).toBe("sayHello");
    expect(JSON.parse(draft.toolArgs)).toEqual({ name: "Alem" });

    const text = compileChatSnippet({
      kind: "text",
      messageId: "asst-2",
      content: "Hello there",
      threadId: THREAD_ID,
      runId: RUN_ID,
    });
    expect(recipeDraftFromEvents(text.events).textContent).toBe("Hello there");

    const reasoning = compileChatSnippet({
      kind: "reasoning",
      messageId: "think-1",
      content: "I should check the weather",
      threadId: THREAD_ID,
      runId: RUN_ID,
    });
    expect(recipeDraftFromEvents(reasoning.events).reasoningText).toBe(
      "I should check the weather",
    );

    const activity = compileChatSnippet({
      kind: "activity",
      messageId: "act-2",
      activityType: "a2ui-surface",
      content: { a2ui_operations: [] },
      threadId: THREAD_ID,
      runId: RUN_ID,
    });
    const activityDraft = recipeDraftFromEvents(activity.events);
    expect(activityDraft.activityType).toBe("a2ui-surface");
    expect(JSON.parse(activityDraft.activityContent)).toEqual({
      a2ui_operations: [],
    });

    const editor = editorStateFromSnippet({
      id: "snip-text",
      name: text.name,
      recipe: text.recipe,
      events: text.events,
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
    });
    expect(editor.recipe).toBe("text");
    expect(editor.draft.textContent).toBe("Hello there");
    expect(editor.json).toContain("TEXT_MESSAGE_CONTENT");
  });

  it("saves an activity message as a snapshot", () => {
    const compiled = compileFromActivityMessage({
      message: {
        id: "act-1",
        activityType: "open-generative-ui",
        content: { html: ["<div>Hi</div>"], htmlComplete: true },
      },
      threadId: THREAD_ID,
      runId: RUN_ID,
    });
    expect(compiled.recipe).toBe("activity");
    expect(compiled.name).toContain("open-generative-ui");
    const snapshot = compiled.events.find(
      (event) => event.type === "ACTIVITY_SNAPSHOT",
    );
    expect(snapshot?.activityType).toBe("open-generative-ui");
  });

  it("rejects empty text and tool captures", () => {
    expect(() =>
      compileChatSnippet({
        kind: "text",
        messageId: "empty",
        content: "  ",
        threadId: THREAD_ID,
        runId: RUN_ID,
      }),
    ).toThrow("Assistant text is required.");
    expect(() =>
      compileChatSnippet({
        kind: "tool-call",
        messageId: "asst-1",
        toolCallId: "call-1",
        toolName: "",
        argsJson: "{}",
        threadId: THREAD_ID,
        runId: RUN_ID,
      }),
    ).toThrow("Tool name is required.");
  });
});

describe("event snippet sidebar and run expansion", () => {
  it("groups saved snippets by recipe and names an icon for each", () => {
    const groups = groupEventSnippets([
      {
        id: "t",
        name: "sayHello",
        recipe: "tool-call",
        events: [{ type: "TOOL_CALL_END" }],
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z",
      },
      {
        id: "x",
        name: "Hello",
        recipe: "text",
        events: [{ type: "TEXT_MESSAGE_END" }],
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z",
      },
    ]);
    expect(groups.map((group) => group.recipe)).toEqual(["tool-call", "text"]);
    expect(recipeIconName("tool-call")).toBe("Hammer");
    expect(recipeIconName("activity")).toBe("LayoutDashboard");
    expect(recipeIconWrapClass("tool-call")).toContain("amber");
    expect(recipeIconWrapClass("reasoning")).toContain("violet");
  });

  it("treats empty or invalid JSON as not runnable", () => {
    expect(snippetJsonIsRunnable("[]")).toBe(false);
    expect(snippetJsonIsRunnable("{")).toBe(false);
    expect(snippetJsonIsRunnable('[{"type":"RUN_STARTED"}]')).toBe(true);
  });

  it("expands generateSandboxedUi tool args into an activity snapshot", () => {
    const compiled = compileChatSnippet({
      kind: "tool-call",
      messageId: "asst-1",
      toolCallId: "call-ui",
      toolName: "generateSandboxedUi",
      argsJson: '{"html":"<div>Hello sandbox</div>","css":"div{color:red}"}',
      threadId: THREAD_ID,
      runId: RUN_ID,
    });
    const expanded = expandSnippetEventsForRun(compiled.events);
    const snapshot = expanded.find(
      (event) => event.type === "ACTIVITY_SNAPSHOT",
    );
    expect(snapshot?.activityType).toBe("open-generative-ui");
    expect(snapshot?.messageId).toBe("call-ui-activity");
    expect(snapshot?.content).toMatchObject({
      html: ["<div>Hello sandbox</div>"],
      htmlComplete: true,
      generating: false,
    });
    expect(typesOf(expanded)).toContain("TOOL_CALL_RESULT");
    expect(
      expanded.find((event) => event.type === "TOOL_CALL_RESULT")?.content,
    ).toBe("UI generated");
    expect(typesOf(expanded).at(-1)).toBe("RUN_FINISHED");
  });

  it("does not add a tool result when generateSandboxedUi args have no UI", () => {
    const events = compileToolCallRecipe({
      toolName: "generateSandboxedUi",
      argsJson: '{"placeholderMessages":["Working"]}',
      threadId: THREAD_ID,
      runId: RUN_ID,
      parentMessageId: "asst-empty",
      toolCallId: "call-empty",
    });
    const expanded = expandSnippetEventsForRun(events);
    expect(typesOf(expanded)).not.toContain("ACTIVITY_SNAPSHOT");
    expect(typesOf(expanded)).not.toContain("TOOL_CALL_RESULT");
  });

  it("does not add a second open-generative-ui snapshot when one exists", () => {
    const events = [
      { type: "ACTIVITY_SNAPSHOT", activityType: "open-generative-ui" },
      {
        type: "TOOL_CALL_START",
        toolCallId: "call-ui",
        toolCallName: "generateSandboxedUi",
      },
    ];
    const expanded = expandSnippetEventsForRun(events);
    expect(
      expanded.filter((event) => event.type === "ACTIVITY_SNAPSHOT"),
    ).toHaveLength(1);
    expect(
      expanded.find((event) => event.type === "TOOL_CALL_RESULT")?.toolCallId,
    ).toBe("call-ui");
  });
});

describe("event snippet JSON", () => {
  it("parses a valid event array and rejects bad JSON", () => {
    expect(parseSnippetEvents('[{"type":"RUN_STARTED"}]')).toEqual([
      { type: "RUN_STARTED" },
    ]);
    expect(() => parseSnippetEvents("{")).toThrow("Snippet JSON is invalid.");
    expect(() => parseSnippetEvents("{}")).toThrow(
      "Snippet JSON must be an array of events.",
    );
    expect(() => parseSnippetEvents('[{"noType":true}]')).toThrow(
      "Each event must have a string type.",
    );
  });
});

describe("event snippet storage", () => {
  afterEach(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(EVENT_SNIPPETS_STORAGE_KEY);
    }
  });

  it("round-trips upsert, load, export, import, and delete", () => {
    const storage = memoryStorage();
    const snippet: EventSnippet = {
      id: "snip-1",
      name: "Weather",
      recipe: "tool-call",
      events: [{ type: "TOOL_CALL_END", toolCallId: "c1" }],
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
    };
    upsertEventSnippet(snippet, storage);
    expect(loadEventSnippets(storage)).toEqual([snippet]);

    const exported = exportEventSnippetsJson(loadEventSnippets(storage));
    const other = memoryStorage();
    const imported = importEventSnippets(exported, other);
    expect(imported).toHaveLength(1);
    expect(imported[0]?.id).not.toBe("snip-1");
    expect(imported[0]?.name).toBe("Weather");

    expect(deleteEventSnippet("snip-1", storage)).toEqual([]);
  });

  it("leaves existing snippets in place when import JSON is invalid", () => {
    const storage = memoryStorage();
    const snippet: EventSnippet = {
      id: "keep-me",
      name: "Keep",
      recipe: "text",
      events: [{ type: "TEXT_MESSAGE_END", messageId: "m1" }],
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
    };
    upsertEventSnippet(snippet, storage);
    expect(() => importEventSnippets("{", storage)).toThrow(
      "Import JSON is invalid.",
    );
    expect(loadEventSnippets(storage)).toEqual([snippet]);
  });
});
