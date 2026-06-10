/**
 * Coverage for the bridge-restart recovery path: resume values are
 * encoded into Block Kit button.value at picker-post time, Slack stores
 * them, and on click the bridge can resume the LangGraph graph purely
 * from the click payload — no in-memory registry needed.
 */
import { describe, it, expect, vi } from "vitest";
import type { KnownBlock } from "@slack/types";
import {
  HumanInTheLoopRegistry,
  injectResumeValues,
} from "../human-in-the-loop.js";
import { z } from "zod";
import {
  clickToConversation,
  recoverInterruptFromStaleClick,
} from "../turn-runner.js";
import { defineInterruptHandler } from "../interrupt.js";
import { DM_SCOPE } from "../types.js";

describe("injectResumeValues", () => {
  it("injects JSON.stringify(value) into button.value for matching action_ids", () => {
    const actionMap = new Map<string, unknown>([
      ["aid-1", { chosen: "A" }],
      ["aid-2", { chosen: "B" }],
    ]);
    const blocks: KnownBlock[] = [
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "A" },
            action_id: "aid-1",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "B" },
            action_id: "aid-2",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "?" },
            action_id: "unbound",
          },
        ],
      },
    ];
    const out = injectResumeValues(blocks, actionMap);
    const els = (
      out[0] as unknown as { elements: Array<Record<string, unknown>> }
    ).elements;
    expect(els[0]?.value).toBe('{"chosen":"A"}');
    expect(els[1]?.value).toBe('{"chosen":"B"}');
    // Unbound button (action_id not in map) keeps its original shape.
    expect(els[2]?.value).toBeUndefined();
  });

  it("leaves non-button elements alone (registry remains the fallback for them)", () => {
    const blocks: KnownBlock[] = [
      {
        type: "actions",
        elements: [
          // Static-select carries action_id but no free-form value field.
          {
            type: "static_select",
            action_id: "select-1",
            options: [{ text: { type: "plain_text", text: "X" }, value: "x" }],
          },
        ],
      },
    ];
    const out = injectResumeValues(
      blocks,
      new Map<string, unknown>([["select-1", { whatever: true }]]),
    );
    // The select-element shape isn't mutated (no top-level "value" forced
    // on it; the per-option `value` stays user-controlled).
    expect((out[0] as { elements: unknown[] }).elements[0]).toEqual(
      blocks[0] && "elements" in blocks[0]
        ? blocks[0].elements?.[0]
        : undefined,
    );
  });

  it("visits `accessory` and `element` containers too (section.accessory, input.element)", () => {
    const blocks: KnownBlock[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: "Pick" },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Go" },
          action_id: "aid-go",
        },
      },
    ];
    const out = injectResumeValues(
      blocks,
      new Map<string, unknown>([["aid-go", { go: true }]]),
    );
    const acc = (out[0] as { accessory: { value: string } }).accessory;
    expect(acc.value).toBe('{"go":true}');
  });

  it("throws if the encoded value exceeds Slack's 2000-char button.value cap", () => {
    const big = { huge: "x".repeat(2500) };
    expect(() =>
      injectResumeValues(
        [
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "A" },
                action_id: "aid-big",
              },
            ],
          },
        ],
        new Map<string, unknown>([["aid-big", big]]),
      ),
    ).toThrow(/2000/);
  });
});

describe("HumanInTheLoopRegistry.handleAction with decoded click value", () => {
  it("prefers the decoded click value over the registry's stored value", async () => {
    const r = new HumanInTheLoopRegistry();
    const id = r.mintActionId();
    const promise = r.startWaiting({
      conversationKey: "k",
      actionMap: new Map<string, unknown>([[id, { stored: "fallback" }]]),
    });
    r.handleAction(id, undefined, { fromClick: true });
    const { result } = await promise;
    expect(result).toEqual({ kind: "resolved", value: { fromClick: true } });
  });

  it("falls back to the stored value when the click doesn't carry one", async () => {
    const r = new HumanInTheLoopRegistry();
    const id = r.mintActionId();
    const promise = r.startWaiting({
      conversationKey: "k",
      actionMap: new Map<string, unknown>([[id, { stored: "ok" }]]),
    });
    r.handleAction(id);
    const { result } = await promise;
    expect(result).toEqual({ kind: "resolved", value: { stored: "ok" } });
  });
});

describe("clickToConversation", () => {
  it("threaded picker → thread scope + replyTarget.threadTs", () => {
    const r = clickToConversation({ channelId: "C1", threadTs: "100.0" });
    expect(r.conversation).toEqual({ channelId: "C1", scope: "100.0" });
    expect(r.replyTarget).toEqual({ channel: "C1", threadTs: "100.0" });
  });

  it("DM picker → DM_SCOPE, no thread_ts on the reply target", () => {
    const r = clickToConversation({ channelId: "D1", channelType: "im" });
    expect(r.conversation).toEqual({ channelId: "D1", scope: DM_SCOPE });
    expect(r.replyTarget).toEqual({ channel: "D1", threadTs: undefined });
  });
});

describe("recoverInterruptFromStaleClick", () => {
  const meetingHandler = defineInterruptHandler({
    name: "schedule_meeting_picker",
    description: "test handler",
    payload: z.object({
      topic: z.string(),
      attendee: z.string().nullable().optional(),
    }),
    render(state) {
      if (state.status === "pending") return [{ type: "divider" }];
      if (state.status === "resolved") {
        const v = state.value as { chosen_label: string } | { cancelled: true };
        if ("cancelled" in v) return "delete";
        return [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:white_check_mark: Booked *${v.chosen_label}* for *${state.payload.topic}*`,
            },
          },
        ];
      }
      return "noop";
    },
  });

  function makeStubs(opts?: { fetchMessage?: Record<string, unknown> }) {
    const runAgent = vi.fn(async () => undefined);
    const makeAgent = vi.fn(() => {
      return {
        threadId: "",
        messages: [],
        runAgent,
        abortRun: vi.fn(),
      } as never;
    });
    const postMessage = vi.fn(async () => ({ ok: true, ts: "1.0" }));
    const update = vi.fn(async () => ({ ok: true }));
    const deleteFn = vi.fn(async () => ({ ok: true }));
    const replies = vi.fn(async () => ({
      ok: true,
      messages: opts?.fetchMessage ? [opts.fetchMessage] : [],
    }));
    const fetchMock = vi.fn(async () => new Response("ok"));
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;
    const client = {
      chat: { postMessage, update, delete: deleteFn },
      conversations: { replies },
    };
    const hitlRegistry = new HumanInTheLoopRegistry();
    return {
      runAgent,
      makeAgent,
      postMessage,
      update,
      deleteFn,
      replies,
      fetchMock,
      client,
      hitlRegistry,
    };
  }

  const baseArgs = {
    conversation: { channelId: "C1", scope: "100.0" },
    replyTarget: { channel: "C1", threadTs: "100.0" },
  };

  it("fires runAgent with forwardedProps.command.resume on the recovered threadId", async () => {
    const s = makeStubs();
    await recoverInterruptFromStaleClick({
      ...baseArgs,
      resumeValue: { chosen_label: "Tomorrow 2:00 PM" },
      click: { responseUrl: undefined, messageTs: "1.0" },
      interruptHandlers: [meetingHandler],
      humanInTheLoopComponents: [],
      hitlRegistry: s.hitlRegistry,
      client: s.client as never,
      makeAgent: s.makeAgent,
      botUserId: "BOT01",
    });
    expect(s.makeAgent).toHaveBeenCalledWith("slack-C1-100.0");
    expect(s.runAgent).toHaveBeenCalledTimes(1);
    const arg = (s.runAgent.mock.calls[0] as unknown as [unknown])[0];
    expect(arg).toEqual({
      forwardedProps: {
        command: { resume: { chosen_label: "Tomorrow 2:00 PM" } },
      },
    });
  });

  it("when the picker has handler metadata, calls render({status:resolved}) and replaces the picker via response_url", async () => {
    const s = makeStubs({
      fetchMessage: {
        ts: "1.0",
        metadata: {
          event_type: "copilotkit_slack_interrupt",
          event_payload: {
            handler: "schedule_meeting_picker",
            payload: { topic: "Q2 1:1", attendee: "Alice" },
          },
        },
      },
    });
    await recoverInterruptFromStaleClick({
      ...baseArgs,
      resumeValue: { chosen_label: "Tomorrow 2:00 PM" },
      click: { responseUrl: "https://hooks.slack.com/x", messageTs: "1.0" },
      interruptHandlers: [meetingHandler],
      humanInTheLoopComponents: [],
      hitlRegistry: s.hitlRegistry,
      client: s.client as never,
      makeAgent: s.makeAgent,
      botUserId: "BOT01",
    });
    expect(s.fetchMock).toHaveBeenCalled();
    const fetchCall = s.fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(fetchCall[0]).toBe("https://hooks.slack.com/x");
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.replace_original).toBe(true);
    expect(body.blocks[0].text.text).toContain(
      "Booked *Tomorrow 2:00 PM* for *Q2 1:1*",
    );
    // Resume still fires after the resolved render.
    expect(s.runAgent).toHaveBeenCalledTimes(1);
  });

  it("resumes on the threadId persisted in the picker metadata (unique-per-turn recovery)", async () => {
    const s = makeStubs({
      fetchMessage: {
        ts: "1.0",
        metadata: {
          event_type: "copilotkit_slack_interrupt",
          event_payload: {
            handler: "schedule_meeting_picker",
            payload: { topic: "Q2 1:1", attendee: "Alice" },
            // The paused turn's unique thread, recorded when the picker
            // was posted. Recovery must resume on *this* thread, not a
            // re-derived stable id (which would never have existed).
            threadId: "slack-C1-100.0-abc-123",
          },
        },
      },
    });
    await recoverInterruptFromStaleClick({
      ...baseArgs,
      resumeValue: { chosen_label: "Tomorrow 2:00 PM" },
      click: { responseUrl: "https://hooks.slack.com/x", messageTs: "1.0" },
      interruptHandlers: [meetingHandler],
      humanInTheLoopComponents: [],
      hitlRegistry: s.hitlRegistry,
      client: s.client as never,
      makeAgent: s.makeAgent,
      botUserId: "BOT01",
    });
    const agent = (
      s.makeAgent.mock.results[0] as { value: { threadId: string } }
    ).value;
    expect(agent.threadId).toBe("slack-C1-100.0-abc-123");
    expect(s.runAgent).toHaveBeenCalledTimes(1);
  });

  it("when the picker has no metadata, skips resolved render but still resumes", async () => {
    const s = makeStubs({
      fetchMessage: { ts: "1.0" /* no metadata field */ },
    });
    await recoverInterruptFromStaleClick({
      ...baseArgs,
      resumeValue: { chosen_label: "X" },
      click: { responseUrl: "https://hooks.slack.com/x", messageTs: "1.0" },
      interruptHandlers: [meetingHandler],
      humanInTheLoopComponents: [],
      hitlRegistry: s.hitlRegistry,
      client: s.client as never,
      makeAgent: s.makeAgent,
      botUserId: "BOT01",
    });
    // No response_url fetch — resolved render skipped.
    expect(s.fetchMock).not.toHaveBeenCalled();
    // Resume still fires.
    expect(s.runAgent).toHaveBeenCalledTimes(1);
  });

  it("when the handler name isn't registered, skips resolved render but still resumes", async () => {
    const s = makeStubs({
      fetchMessage: {
        ts: "1.0",
        metadata: {
          event_type: "copilotkit_slack_interrupt",
          event_payload: { handler: "unknown_handler", payload: {} },
        },
      },
    });
    await recoverInterruptFromStaleClick({
      ...baseArgs,
      resumeValue: { x: 1 },
      click: { responseUrl: "https://hooks.slack.com/x", messageTs: "1.0" },
      interruptHandlers: [meetingHandler],
      humanInTheLoopComponents: [],
      hitlRegistry: s.hitlRegistry,
      client: s.client as never,
      makeAgent: s.makeAgent,
      botUserId: "BOT01",
    });
    expect(s.fetchMock).not.toHaveBeenCalled();
    expect(s.runAgent).toHaveBeenCalledTimes(1);
  });

  it("posts a :warning: if the resume runAgent throws", async () => {
    const postMessage = vi.fn(async () => ({ ok: true, ts: "1.0" }));
    const makeAgent = () =>
      ({
        threadId: "",
        messages: [],
        runAgent: vi.fn(async () => {
          throw new Error("graph blew up");
        }),
        abortRun: vi.fn(),
      }) as never;
    const replies = vi.fn(async () => ({ ok: true, messages: [] }));
    await recoverInterruptFromStaleClick({
      ...baseArgs,
      resumeValue: { ok: true },
      click: {},
      interruptHandlers: [meetingHandler],
      humanInTheLoopComponents: [],
      hitlRegistry: new HumanInTheLoopRegistry(),
      client: {
        chat: { postMessage, update: vi.fn(), delete: vi.fn() },
        conversations: { replies },
      } as never,
      makeAgent,
      botUserId: "BOT01",
    });
    expect(postMessage).toHaveBeenCalled();
    const postCall = postMessage.mock.calls[0] as unknown as [
      { text?: string },
    ];
    expect(postCall[0].text).toContain("graph blew up");
  });
});
