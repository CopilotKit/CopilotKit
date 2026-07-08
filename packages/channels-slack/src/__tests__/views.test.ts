import { describe, it, expect, vi } from "vitest";
import { decodeViewSubmission, decodeViewClosed } from "../interaction.js";
import { SlackAdapter } from "../adapter.js";
import type { BotNode } from "@copilotkit/channels-ui";

describe("decodeViewSubmission", () => {
  it("parses field values from a view_submission payload", () => {
    const evt = decodeViewSubmission(
      {
        callback_id: "triage",
        private_metadata: "meta",
        state: {
          values: {
            summary: { summary: { type: "plain_text_input", value: "boom" } },
            prio: {
              prio: {
                type: "static_select",
                selected_option: { value: "high" },
              },
            },
            team: {
              team: {
                type: "radio_buttons",
                selected_option: { value: "core" },
              },
            },
          },
        },
      },
      { id: "U1" },
    );
    expect(evt).toMatchObject({
      callbackId: "triage",
      privateMetadata: "meta",
      values: { summary: "boom", prio: "high", team: "core" },
      user: { id: "U1" },
      platform: "slack",
    });
  });

  it("decodes a __cpk envelope into conversationKey + replyTarget and restores pm", () => {
    const evt = decodeViewSubmission(
      {
        callback_id: "file_issue",
        private_metadata: JSON.stringify({
          __cpk: { channel: "C123", threadTs: "1700.5" },
          pm: "authorMeta",
        }),
        state: { values: {} },
      },
      { id: "U1" },
    );
    expect(evt.conversationKey).toBe("C123::1700.5");
    expect(evt.replyTarget).toEqual({ channel: "C123", threadTs: "1700.5" });
    expect(evt.privateMetadata).toBe("authorMeta");
  });

  it("uses DM_SCOPE when the envelope has no threadTs", () => {
    const evt = decodeViewSubmission(
      {
        callback_id: "file_issue",
        private_metadata: JSON.stringify({
          __cpk: { channel: "D999" },
        }),
        state: { values: {} },
      },
      { id: "U1" },
    );
    expect(evt.conversationKey).toBe("D999::dm");
    expect(evt.replyTarget).toEqual({ channel: "D999" });
    expect(evt.privateMetadata).toBeUndefined();
  });

  it("passes a plain (non-envelope) private_metadata through with no conversationKey/replyTarget", () => {
    const evt = decodeViewSubmission(
      {
        callback_id: "triage",
        private_metadata: "just-a-string",
        state: { values: {} },
      },
      { id: "U1" },
    );
    expect(evt.privateMetadata).toBe("just-a-string");
    expect(evt.conversationKey).toBeUndefined();
    expect(evt.replyTarget).toBeUndefined();
  });
});

describe("decodeViewClosed", () => {
  it("decodes a __cpk envelope into conversationKey + replyTarget and restores pm", () => {
    const evt = decodeViewClosed(
      {
        callback_id: "file_issue",
        private_metadata: JSON.stringify({
          __cpk: { channel: "C123", threadTs: "1700.5" },
          pm: "authorMeta",
        }),
      },
      { id: "U1" },
    );
    expect(evt.conversationKey).toBe("C123::1700.5");
    expect(evt.replyTarget).toEqual({ channel: "C123", threadTs: "1700.5" });
    expect(evt.privateMetadata).toBe("authorMeta");
  });

  it("passes a plain private_metadata through with no conversationKey/replyTarget", () => {
    const evt = decodeViewClosed(
      {
        callback_id: "triage",
        private_metadata: "plain",
      },
      { id: "U1" },
    );
    expect(evt.privateMetadata).toBe("plain");
    expect(evt.conversationKey).toBeUndefined();
    expect(evt.replyTarget).toBeUndefined();
  });
});

describe("SlackAdapter.openModal", () => {
  const modalIr: BotNode[] = [
    {
      type: "modal",
      props: {
        callbackId: "file_issue",
        title: "File issue",
        children: [],
      },
    } as unknown as BotNode,
  ];

  function makeAdapter() {
    const adapter = new SlackAdapter({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    const open = vi.fn().mockResolvedValue({ ok: true });
    // Replace the WebClient with a stub exposing only views.open.
    (
      adapter as unknown as { client: { views: { open: typeof open } } }
    ).client = { views: { open } } as never;
    return { adapter, open };
  }

  it("stamps a __cpk envelope carrying the target channel/threadTs into private_metadata", async () => {
    const { adapter, open } = makeAdapter();
    const res = await adapter.openModal(
      { channel: "C123", threadTs: "1700.5" } as never,
      "trigger-1",
      modalIr,
    );
    expect(res.ok).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    const arg = open.mock.calls[0]![0] as {
      view: { private_metadata: string };
    };
    const envelope = JSON.parse(arg.view.private_metadata);
    expect(envelope.__cpk).toEqual({ channel: "C123", threadTs: "1700.5" });
  });

  it("preserves an author-set private_metadata under pm", async () => {
    const { adapter, open } = makeAdapter();
    const irWithMeta: BotNode[] = [
      {
        type: "modal",
        props: {
          callbackId: "file_issue",
          title: "File issue",
          privateMetadata: "authorMeta",
          children: [],
        },
      } as unknown as BotNode,
    ];
    await adapter.openModal(
      { channel: "C123" } as never,
      "trigger-1",
      irWithMeta,
    );
    const arg = open.mock.calls[0]![0] as {
      view: { private_metadata: string };
    };
    const envelope = JSON.parse(arg.view.private_metadata);
    expect(envelope.__cpk).toEqual({ channel: "C123" });
    expect(envelope.pm).toBe("authorMeta");
  });
});
