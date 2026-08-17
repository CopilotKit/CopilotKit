import { describe, it, expect, vi } from "vitest";
import { decodeViewSubmission, decodeViewClosed } from "../interaction.js";
import { SlackAdapter } from "../adapter.js";
import type { ChannelNode } from "@copilotkit/channels-ui";

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
      { id: "U1", kind: "human" },
    );
    expect(evt).toMatchObject({
      callbackId: "triage",
      privateMetadata: "meta",
      values: { summary: "boom", prio: "high", team: "core" },
      actor: { id: "U1", kind: "human" },
      platform: "slack",
    });
  });

  // OSS-846: the message-click path now shares this flattening. The helper it
  // shares used to read `value ?? selected_option.value` only, so every element
  // family that reports under a different key came back `undefined` — silently,
  // in modal submissions too.
  it("parses element families the old value ?? selected_option reader lost", () => {
    const evt = decodeViewSubmission(
      {
        callback_id: "triage",
        state: {
          values: {
            services: {
              services: {
                type: "multi_static_select",
                selected_options: [{ value: "payments" }, { value: "search" }],
              },
            },
            responders: {
              responders: {
                type: "multi_users_select",
                selected_users: ["U1", "U2"],
              },
            },
            owner: { owner: { type: "users_select", selected_user: "U9" } },
            escalate_in: {
              escalate_in: { type: "channels_select", selected_channel: "C7" },
            },
            notify: {
              notify: {
                type: "multi_conversations_select",
                selected_conversations: ["C1"],
              },
            },
            target_date: {
              target_date: { type: "datepicker", selected_date: "2026-08-20" },
            },
            cutover_at: {
              cutover_at: { type: "timepicker", selected_time: "14:32" },
            },
            deadline: {
              deadline: {
                type: "datetimepicker",
                selected_date_time: 1786451118,
              },
            },
          },
        },
      },
      { id: "U1", kind: "human" },
    );

    expect(evt.values).toEqual({
      services: ["payments", "search"],
      responders: ["U1", "U2"],
      owner: "U9",
      escalate_in: "C7",
      notify: ["C1"],
      target_date: "2026-08-20",
      cutover_at: "14:32",
      deadline: 1786451118,
    });
  });

  it("reports a select with nothing chosen as undefined, not a crash", () => {
    // Slack sends `selected_option: null` for an untouched select.
    const evt = decodeViewSubmission(
      {
        callback_id: "triage",
        state: {
          values: {
            prio: { prio: { type: "static_select", selected_option: null } },
          },
        },
      },
      { id: "U1", kind: "human" },
    );
    expect(evt.values).toEqual({ prio: undefined });
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
      { id: "U1", kind: "human" },
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
      { id: "U1", kind: "human" },
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
      { id: "U1", kind: "human" },
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
      { id: "U1", kind: "human" },
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
      { id: "U1", kind: "human" },
    );
    expect(evt.privateMetadata).toBe("plain");
    expect(evt.conversationKey).toBeUndefined();
    expect(evt.replyTarget).toBeUndefined();
  });
});

describe("SlackAdapter.openModal", () => {
  const modalIr: ChannelNode[] = [
    {
      type: "modal",
      props: {
        callbackId: "file_issue",
        title: "File issue",
        children: [],
      },
    } as unknown as ChannelNode,
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
    const irWithMeta: ChannelNode[] = [
      {
        type: "modal",
        props: {
          callbackId: "file_issue",
          title: "File issue",
          privateMetadata: "authorMeta",
          children: [],
        },
      } as unknown as ChannelNode,
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
