import { MemoryStore } from "@copilotkit/channels-core";
import { Chart, Markdown, Modal, TextInput } from "@copilotkit/channels-ui";
import { describe, expect, it, vi } from "vitest";
import { DeliveryAdapter } from "./delivery-adapter.js";
import type {
  ClaimedChannelDelivery,
  PreparedChannelDelivery,
} from "./delivery-transport.js";
import type { IngressSink, InteractionEvent } from "@copilotkit/channels-core";

function delivery(): PreparedChannelDelivery {
  return {
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_discord_adapter_01",
    deliveryExpiresAt: "2099-07-29T17:00:00.000Z",
    channelId: "channel_discord_adapter",
    channelName: "support",
    surfaceId: "surface_support_01",
    canonicalThreadId: "thread_discord_adapter",
    appUserId: "discord:guild:user",
    adapter: "discord",
    turn: {
      eventId: "evt_discord_adapter",
      receivedAt: "2026-08-05T08:00:00.000Z",
      input: {
        kind: "interaction",
        actionId: "open_triage",
        triggerId: "interaction-1",
      },
      actor: { externalUserId: "user", kind: "human" },
    },
  };
}

function makeAdapter(store = new MemoryStore()): DeliveryAdapter {
  return new DeliveryAdapter({
    channelName: "support",
    transport: {} as never,
    store,
    runCanonical: async () => ({ iterations: 0, interrupted: false }),
    loadHistory: async () => [],
  });
}

function target(claimedDelivery: ClaimedChannelDelivery) {
  return { claimedDelivery, delivery: delivery() };
}

describe("managed Discord delivery", () => {
  it("streams long Discord replies through stable message chunks", async () => {
    const effects: Array<Record<string, unknown>> = [];
    let created = 0;
    const claimed = {
      effect: vi.fn().mockImplementation((_id, payload) => {
        effects.push(payload);
        if (payload.kind === "discord.message.create") {
          created += 1;
          return Promise.resolve({
            providerReference: `pref_v1_discord_stream_${created}`,
            providerMessageId: `pid_v1_${String(created).padEnd(43, "a")}`,
          });
        }
        return Promise.resolve({});
      }),
    } as unknown as ClaimedChannelDelivery;

    async function* chunks() {
      yield "a".repeat(1_850);
      yield " ";
      yield "b".repeat(300);
    }

    await makeAdapter().stream(target(claimed), chunks());

    expect(
      effects.filter((payload) => payload.kind === "discord.message.create"),
    ).toHaveLength(2);
    expect(
      effects.filter((payload) => payload.kind === "discord.message.replace"),
    ).not.toHaveLength(0);
    expect(
      effects.every((payload) => !String(payload.kind).startsWith("teams.")),
    ).toBe(true);
    expect(
      effects
        .filter((payload) => payload.kind === "discord.message.replace")
        .every((payload) => String(payload.content).length <= 2_000),
    ).toBe(true);
  });

  it("stages chart bytes and sends the rendered attachment handle", async () => {
    const uploadFile = vi.fn().mockResolvedValue("file_chart_01");
    const effect = vi.fn().mockResolvedValue({
      providerReference: "pref_v1_discord_chart_123",
      providerMessageId: "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
    });
    const claimed = { uploadFile, effect } as unknown as ClaimedChannelDelivery;

    await makeAdapter().post(target(claimed), [
      Chart({
        type: "line",
        title: "Requests",
        data: [
          { label: "Mon", value: 10 },
          { label: "Tue", value: 14 },
        ],
      }),
    ]);

    expect(uploadFile).toHaveBeenCalledWith(
      expect.stringContaining("_attachment_0"),
      expect.objectContaining({
        filename: "chart-1.png",
        altText: expect.stringContaining("Requests"),
        bytes: expect.any(Uint8Array),
      }),
    );
    const bytes = uploadFile.mock.calls[0]![1].bytes as Uint8Array;
    expect(Array.from(bytes.slice(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    expect(effect).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        kind: "discord.message.create",
        flags: 32_768,
        attachmentHandles: ["file_chart_01"],
      }),
    );
  });

  it("uploads a normal file through the Discord file effect", async () => {
    const claimed = {
      uploadFile: vi.fn().mockResolvedValue("file_report_01"),
      effect: vi.fn().mockResolvedValue({}),
    } as unknown as ClaimedChannelDelivery;

    await expect(
      makeAdapter().postFile(target(claimed), {
        bytes: new Uint8Array([1, 2, 3]),
        filename: "report.txt",
        altText: "Weekly report",
      }),
    ).resolves.toMatchObject({ ok: true, assetId: "file_report_01" });
    expect(claimed.effect).toHaveBeenCalledWith(expect.any(String), {
      kind: "discord.file.create",
      fileHandle: "file_report_01",
      filename: "report.txt",
      description: "Weekly report",
    });
  });

  it("opens a modal with a durable opaque binding", async () => {
    const store = new MemoryStore();
    const effect = vi.fn().mockResolvedValue({ ok: true });
    const claimed = { effect } as unknown as ClaimedChannelDelivery;
    const modal = [
      Modal({
        title: "Triage",
        callbackId: "triage",
        privateMetadata: "incident-42",
        children: [TextInput({ id: "summary", label: "Summary" })],
      }),
    ];

    await expect(
      makeAdapter(store).openModal?.(target(claimed), "interaction-1", modal),
    ).resolves.toEqual({ ok: true });
    const payload = effect.mock.calls[0]![1] as {
      customId: string;
      components: unknown[];
    };
    expect(payload).toMatchObject({
      kind: "discord.modal.open",
      title: "Triage",
      customId: expect.stringMatching(/^ck-modal:/),
      components: expect.any(Array),
    });
    await expect(
      store.kv.get(`discord:modal:${payload.customId}`),
    ).resolves.toMatchObject({
      callbackId: "triage",
      privateMetadata: "incident-42",
    });
  });

  it("consumes a durable modal binding after a Runtime restart", async () => {
    const store = new MemoryStore();
    const openedEffect = vi.fn().mockResolvedValue({ ok: true });
    const openedClaim = {
      effect: openedEffect,
    } as unknown as ClaimedChannelDelivery;
    await makeAdapter(store).openModal?.(target(openedClaim), "interaction-1", [
      Modal({
        title: "Triage",
        callbackId: "triage",
        privateMetadata: "incident-42",
        children: [TextInput({ id: "summary", label: "Summary" })],
      }),
    ]);
    const customId = (openedEffect.mock.calls[0]![1] as { customId: string })
      .customId;

    let dispatch:
      | ((
          claimed: ClaimedChannelDelivery,
          prepared: PreparedChannelDelivery,
        ) => Promise<void>)
      | undefined;
    const restarted = new DeliveryAdapter({
      channelName: "support",
      store,
      transport: {
        start: (handler: typeof dispatch) => {
          dispatch = handler;
        },
        stop: async () => undefined,
      } as never,
      runCanonical: async () => ({ iterations: 0, interrupted: false }),
      loadHistory: async () => [],
    });
    const onModalSubmit = vi.fn().mockResolvedValue(undefined);
    await restarted.start({ onModalSubmit } as unknown as IngressSink);
    const submission = {
      ...delivery(),
      turn: {
        ...delivery().turn,
        input: {
          kind: "interaction" as const,
          actionId: customId,
          values: { summary: "Production is down" },
          submissionKind: "modal" as const,
        },
      },
    } as PreparedChannelDelivery;

    await dispatch?.({} as ClaimedChannelDelivery, submission);

    expect(onModalSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackId: "triage",
        privateMetadata: "incident-42",
        values: { summary: "Production is down" },
        platform: "discord",
      }),
    );
    await expect(
      store.kv.get(`discord:modal:${customId}`),
    ).resolves.toBeUndefined();
  });

  it("hydrates managed modal upload handles without exposing provider URLs", async () => {
    const store = new MemoryStore();
    await store.kv.set(
      "discord:modal:ck-modal:file-upload",
      { callbackId: "triage" },
      60_000,
    );
    let dispatch:
      | ((
          claimed: ClaimedChannelDelivery,
          prepared: PreparedChannelDelivery,
        ) => Promise<void>)
      | undefined;
    const adapter = new DeliveryAdapter({
      channelName: "support",
      store,
      transport: {
        start: (handler: typeof dispatch) => {
          dispatch = handler;
        },
        stop: async () => undefined,
      } as never,
      runCanonical: async () => ({ iterations: 0, interrupted: false }),
      loadHistory: async () => [],
    });
    const onModalSubmit = vi.fn().mockResolvedValue(undefined);
    await adapter.start({ onModalSubmit } as unknown as IngressSink);
    const getContentParts = vi
      .fn()
      .mockResolvedValue([
        { type: "document", source: { kind: "data", data: "report" } },
      ]);
    const submission = {
      ...delivery(),
      turn: {
        ...delivery().turn,
        input: {
          kind: "interaction" as const,
          actionId: "ck-modal:file-upload",
          submissionKind: "modal" as const,
          values: { evidence: ["attachment-1"] },
          modalFiles: {
            evidence: [
              {
                handle: "fileref_attachment_1",
                filename: "report.pdf",
                mimeType: "application/pdf",
                byteSize: 6,
              },
            ],
          },
        },
      },
    } as unknown as PreparedChannelDelivery;

    await dispatch?.(
      { getContentParts } as unknown as ClaimedChannelDelivery,
      submission,
    );

    expect(getContentParts).toHaveBeenCalledWith(
      [expect.objectContaining({ handle: "fileref_attachment_1" })],
      undefined,
    );
    expect(onModalSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        values: {
          evidence: [
            {
              name: "report.pdf",
              mimeType: "application/pdf",
              size: 6,
              contentParts: [
                {
                  type: "document",
                  source: { kind: "data", data: "report" },
                },
              ],
            },
          ],
        },
      }),
    );
  });

  it("looks up users inside the configured Discord delivery scope", async () => {
    let dispatch:
      | ((
          claimed: ClaimedChannelDelivery,
          prepared: PreparedChannelDelivery,
        ) => Promise<void>)
      | undefined;
    const adapter = new DeliveryAdapter({
      channelName: "support",
      transport: {
        start: (handler: typeof dispatch) => {
          dispatch = handler;
        },
        stop: async () => undefined,
      } as never,
      runCanonical: async () => ({ iterations: 0, interrupted: false }),
      loadHistory: async () => [],
    });
    const effect = vi.fn().mockResolvedValue({
      users: [
        {
          id: "123456789012345678",
          displayName: "Ada Lovelace",
          handle: "ada",
          kind: "human",
        },
      ],
    });
    let resolved: unknown;
    await adapter.start({
      onInteraction: async () => {
        resolved = await adapter.lookupUser({ query: "Ada" });
      },
    } as unknown as IngressSink);

    await dispatch?.(
      { effect } as unknown as ClaimedChannelDelivery,
      delivery(),
    );

    expect(effect).toHaveBeenCalledWith(expect.any(String), {
      kind: "discord.user.lookup",
      query: "Ada",
    });
    expect(resolved).toEqual({
      id: "123456789012345678",
      name: "Ada Lovelace",
      handle: "ada",
      kind: "human",
    });
  });

  it("allows mentions only for users resolved inside the active guild scope", async () => {
    let dispatch:
      | ((
          claimed: ClaimedChannelDelivery,
          prepared: PreparedChannelDelivery,
        ) => Promise<void>)
      | undefined;
    const adapter = new DeliveryAdapter({
      channelName: "support",
      transport: {
        start: (handler: typeof dispatch) => {
          dispatch = handler;
        },
        stop: async () => undefined,
      } as never,
      runCanonical: async () => ({ iterations: 0, interrupted: false }),
      loadHistory: async () => [],
    });
    const effect = vi.fn().mockImplementation((_id, payload) => {
      if (payload.kind === "discord.user.lookup") {
        return Promise.resolve({
          users: [
            {
              id: "123456789012345678",
              displayName: "Ada Lovelace",
              handle: "ada",
              kind: "human",
            },
          ],
        });
      }
      return Promise.resolve({
        providerReference: "pref_v1_discord_mention_123",
        providerMessageId: "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
      });
    });
    await adapter.start({
      onInteraction: async (event: InteractionEvent) => {
        await adapter.lookupUser({ query: "Ada" });
        await adapter.post(event.replyTarget, [
          Markdown({ children: "Hello <@123456789012345678> @everyone" }),
        ]);
      },
    } as unknown as IngressSink);

    await dispatch?.(
      { effect } as unknown as ClaimedChannelDelivery,
      delivery(),
    );

    expect(effect).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        kind: "discord.message.create",
        allowedUserMentions: ["123456789012345678"],
      }),
    );
  });
});
