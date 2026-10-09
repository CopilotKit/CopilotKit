import { AbstractAgent } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { EMPTY } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
  ChannelDeliveryTerminatedError,
  Thread,
  ActionRegistry,
  InMemoryActionStore,
  MemoryStore,
} from "@copilotkit/channels-core";
import type { ThreadDeps } from "@copilotkit/channels-core";
import {
  Message,
  Header,
  Render,
  Carousel,
  CarouselCard,
  Button,
} from "@copilotkit/channels-ui";
import { jsx } from "@copilotkit/channels-ui/jsx-runtime";
import {
  assertDeliveryPacket,
  deliveryPacketByteLength,
} from "./delivery-contracts.js";
import type { ChannelProviderPayload } from "./delivery-contracts.js";
import {
  ChannelFileDeliveryUnknownError,
  DeliveryAdapter,
} from "./delivery-adapter.js";
import { ChannelProviderDeliveryError } from "./delivery-transport.js";
import type {
  ClaimedChannelDelivery,
  PreparedChannelDelivery,
} from "./delivery-transport.js";
import { RealtimeGatewayPushError } from "./realtime-gateway.js";

function prepared(): PreparedChannelDelivery {
  return {
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_postfile_01",
    deliveryExpiresAt: "2099-07-29T17:00:00.000Z",
    channelId: "channel_postfile_01",
    channelName: "support",
    canonicalThreadId: "thread_postfile",
    appUserId: "slack:T1:U1",
    adapter: "slack",
    turn: {
      eventId: "evt_postfile",
      receivedAt: "2026-07-29T17:00:00.000Z",
      input: {
        kind: "text",
        text: "hi",
        messageRef: { id: "pref_v1_message_postfile_123" },
        operation: {
          kind: "created",
          logicalMessageId:
            "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
          revisionId: "pid_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
          mentioned: false,
        },
      },
      actor: { externalUserId: "U1", kind: "human" },
    },
  };
}

function replyTarget(
  session: ClaimedChannelDelivery,
  adapter: "slack" | "teams" = "slack",
) {
  return {
    claimedDelivery: session,
    delivery: { ...prepared(), adapter },
  };
}

class NoopAgent extends AbstractAgent {
  run(_input: RunAgentInput): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }
}

function makeAdapter(
  options: Partial<ConstructorParameters<typeof DeliveryAdapter>[0]> = {},
) {
  return new DeliveryAdapter({
    channelName: "support",
    transport: {} as never,
    runCanonical: async () => ({ iterations: 0, interrupted: false }),
    loadHistory: async () => [],
    ...options,
  });
}

describe("DeliveryAdapter.postFile", () => {
  it("soft-returns upload failures without throwing", async () => {
    const log = vi.fn();
    const session = {
      uploadFile: vi.fn().mockRejectedValue(new Error("upload config missing")),
      effect: vi.fn(),
    } as unknown as ClaimedChannelDelivery;
    const adapter = makeAdapter({ log });

    await expect(
      adapter.postFile(replyTarget(session), {
        bytes: new Uint8Array([1]),
        filename: "a.png",
      }),
    ).resolves.toEqual({
      ok: false,
      error: "upload config missing",
    });
    expect(session.effect).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("channel managed asset upload", {
      outcome: "failed",
      code: "asset_upload_failed",
      durationMs: expect.any(Number),
      deliveryId: "dlv_postfile_01",
      byteSize: 1,
    });
  });

  it("rethrows permanent effect failures so claimAndHandle cannot complete", async () => {
    const session = {
      uploadFile: vi.fn().mockResolvedValue("file_handle_01"),
      effect: vi
        .fn()
        .mockRejectedValue(
          new RealtimeGatewayPushError(
            "packet",
            "conflict",
            "file create failed",
          ),
        ),
    } as unknown as ClaimedChannelDelivery;
    const adapter = makeAdapter();

    await expect(
      adapter.postFile(replyTarget(session), {
        bytes: new Uint8Array([1]),
        filename: "a.png",
      }),
    ).rejects.toBeInstanceOf(RealtimeGatewayPushError);

    await expect(
      adapter.postFile(
        replyTarget({
          uploadFile: vi.fn().mockResolvedValue("file_handle_01"),
          effect: vi
            .fn()
            .mockRejectedValue(
              new ChannelProviderDeliveryError("provider_failed", "failed"),
            ),
        } as unknown as ClaimedChannelDelivery),
        { bytes: new Uint8Array([1]), filename: "a.png" },
      ),
    ).rejects.toBeInstanceOf(ChannelProviderDeliveryError);

    await expect(
      adapter.postFile(
        replyTarget({
          uploadFile: vi.fn().mockResolvedValue("file_handle_01"),
          effect: vi
            .fn()
            .mockRejectedValue(
              new TypeError(
                "Gateway returned a conflicting packet acknowledgement",
              ),
            ),
        } as unknown as ClaimedChannelDelivery),
        { bytes: new Uint8Array([1]), filename: "a.png" },
      ),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("returns ok after a successful file create effect", async () => {
    const onEvent = vi.fn();
    const runCanonical = vi.fn(async (args) => {
      await args.execute(
        { onEvent },
        { threadId: args.threadId, runId: args.runId },
      );
      return { iterations: 0, interrupted: false };
    });
    const session = {
      uploadFile: vi.fn().mockResolvedValue("file_handle_01"),
      effect: vi.fn().mockResolvedValue({}),
      getTranscript: vi.fn().mockResolvedValue({
        messages: [],
        truncation: {
          messageLimit: false,
          byteLimit: false,
          omittedMessageCount: 0,
        },
      }),
      consumeTranscriptTriggerPersistence: vi.fn().mockReturnValue(false),
    } as unknown as ClaimedChannelDelivery;
    const adapter = makeAdapter({ runCanonical });
    const target = replyTarget(session);
    const agentSession = await adapter.conversationStore.getOrCreate(
      "thread_postfile",
      target,
      () => new NoopAgent(),
    );

    await expect(
      adapter.postFile(target, {
        bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        filename: "a.png",
        title: "chart",
        altText: "Line chart",
      }),
    ).resolves.toEqual({ ok: true, assetId: "file_handle_01" });
    expect(session.effect).toHaveBeenCalledWith(
      expect.stringMatching(/^response_/),
      expect.objectContaining({
        kind: "slack.file.create",
        fileHandle: "file_handle_01",
        title: "chart",
      }),
    );
    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({
            type: "ACTIVITY_SNAPSHOT",
            messageId: expect.stringMatching(/^activity_/),
            activityType: "copilotkit.managed-asset",
            content: {
              assetId: "file_handle_01",
              filename: "a.png",
              mimeType: "image/png",
              byteSize: 8,
              title: "chart",
              altText: "Line chart",
            },
          }),
        }),
      );
    });
    expect(JSON.stringify(onEvent.mock.calls)).not.toContain("iVBOR");
    await agentSession.release?.();
  });

  it("returns not_delivered so handler code can post a text fallback", async () => {
    const session = {
      uploadFile: vi.fn().mockResolvedValue("file_handle_01"),
      effect: vi.fn().mockResolvedValue({
        deliveryStatus: "not_delivered",
      }),
    } as unknown as ClaimedChannelDelivery;
    const adapter = makeAdapter();

    await expect(
      adapter.postFile(replyTarget(session), {
        bytes: new Uint8Array([1]),
        filename: "a.txt",
      }),
    ).resolves.toEqual({ ok: false, error: "not_delivered" });
  });

  it("throws a typed unknown error after exhausted ambiguous delivery", async () => {
    const session = {
      uploadFile: vi.fn().mockResolvedValue("file_handle_01"),
      effect: vi
        .fn()
        .mockRejectedValue(
          new ChannelProviderDeliveryError(
            "file_delivery_unknown",
            "uncertain",
          ),
        ),
    } as unknown as ClaimedChannelDelivery;
    const adapter = makeAdapter();

    const error = await adapter
      .postFile(replyTarget(session), {
        bytes: new Uint8Array([1]),
        filename: "a.txt",
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ChannelFileDeliveryUnknownError);
    expect(error).toBeInstanceOf(ChannelDeliveryTerminatedError);
  });

  it("keeps confirmed success when canonical history retries exhaust", async () => {
    const log = vi.fn();
    const session = {
      uploadFile: vi.fn().mockResolvedValue("file_handle_01"),
      effect: vi.fn().mockResolvedValue({}),
      getTranscript: vi.fn().mockResolvedValue({
        messages: [],
        truncation: {
          messageLimit: false,
          byteLimit: false,
          omittedMessageCount: 0,
        },
      }),
      consumeTranscriptTriggerPersistence: vi.fn().mockReturnValue(false),
    } as unknown as ClaimedChannelDelivery;
    const adapter = makeAdapter({
      log,
      runCanonical: vi.fn().mockRejectedValue(new Error("writer unavailable")),
    });
    const target = replyTarget(session);
    await adapter.conversationStore.getOrCreate(
      "thread_postfile",
      target,
      () => new NoopAgent(),
    );

    await expect(
      adapter.postFile(target, {
        bytes: new Uint8Array([1]),
        filename: "a.txt",
      }),
    ).resolves.toEqual({ ok: true, assetId: "file_handle_01" });

    await vi.waitFor(() => {
      expect(log).toHaveBeenCalledWith(
        "channel managed asset history",
        expect.objectContaining({
          outcome: "failed",
          code: "canonical_history_gap",
          assetId: "file_handle_01",
        }),
      );
    });
  });

  it("returns a Teams capability error and keeps later text usable", async () => {
    const log = vi.fn();
    const session = {
      uploadFile: vi.fn().mockResolvedValue("file_handle_01"),
      effect: vi
        .fn()
        .mockResolvedValueOnce({ capabilityError: "teams_image_rejected" })
        .mockResolvedValueOnce({
          providerReference: "pref_v1_teams_activity_01",
          providerMessageId:
            "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
        }),
    } as unknown as ClaimedChannelDelivery;
    const adapter = makeAdapter({ log });
    const target = replyTarget(session, "teams");

    await expect(
      adapter.postFile(target, {
        bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        filename: "diagram.png",
        altText: "Architecture diagram",
      }),
    ).resolves.toEqual({
      ok: false,
      error: "teams_image_rejected",
    });
    expect(log).toHaveBeenCalledWith("channel managed asset upload", {
      outcome: "stored",
      code: "asset_stored",
      durationMs: expect.any(Number),
      deliveryId: "dlv_postfile_01",
      byteSize: 8,
    });
    expect(log).toHaveBeenCalledWith("channel provider capability rejected", {
      outcome: "failed",
      code: "teams_image_rejected",
      durationMs: expect.any(Number),
      deliveryId: "dlv_postfile_01",
      adapter: "teams",
    });

    await expect(
      adapter.post(target, [
        {
          type: "text",
          props: { value: "Here is a text fallback" },
        },
      ]),
    ).resolves.toMatchObject({
      providerReference: "pref_v1_teams_activity_01",
    });
    expect(session.effect).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^response_/),
      {
        kind: "teams.message.create",
        text: "Here is a text fallback",
      },
    );
  });

  it("delivers a general Teams file through the managed file effect", async () => {
    const session = {
      uploadFile: vi.fn().mockResolvedValue("file_handle_01"),
      effect: vi.fn().mockResolvedValue({}),
    } as unknown as ClaimedChannelDelivery;

    await expect(
      makeAdapter().postFile(replyTarget(session, "teams"), {
        bytes: new TextEncoder().encode("report"),
        filename: "report.txt",
        title: "Weekly report",
      }),
    ).resolves.toEqual({ ok: true, assetId: "file_handle_01" });
    expect(session.effect).toHaveBeenCalledWith(
      expect.stringMatching(/^response_/),
      {
        kind: "teams.file.create",
        fileHandle: "file_handle_01",
        filename: "report.txt",
        title: "Weekly report",
      },
    );
  });
});

describe("managed JSX delivery", () => {
  function setup(
    provider: "slack" | "teams",
    renderImage?: ThreadDeps["renderImage"],
  ) {
    const packets: ChannelProviderPayload[] = [];
    const session = {
      trackOperation: <T>(operation: () => Promise<T>) => operation(),
      uploadFile: vi.fn().mockResolvedValue("fileref_managed_snapshot_01"),
      effect: vi.fn(
        async (_responseId: string, payload: ChannelProviderPayload) => {
          const packet = {
            protocol: "channel_delivery_v1",
            deliveryId: prepared().deliveryId,
            runtimeInstanceId: "rti_image_test",
            ownerGeneration: 1,
            seq: packets.length,
            packetId: "pkt_image_test",
            payload,
          };
          assertDeliveryPacket(packet);
          expect(deliveryPacketByteLength(packet)).toBeLessThanOrEqual(
            64 * 1024,
          );
          packets.push(payload);
          return {
            providerReference: "pref_v1_managed_image_01",
            providerMessageId:
              "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
          };
        },
      ),
    } as unknown as ClaimedChannelDelivery;
    const registry = new ActionRegistry({ store: new InMemoryActionStore() });
    const thread = new Thread({
      adapter: makeAdapter(),
      replyTarget: replyTarget(session, provider),
      conversationKey: "thread_postfile",
      channelName: "support",
      threadId: "thread_postfile",
      registry,
      agentFactory: () => new NoopAgent(),
      tools: new Map(),
      toolDescriptors: [],
      context: [],
      registerWaiter: () => {},
      interruptHandlers: new Map(),
      state: new MemoryStore(),
      user: null,
      actor: { id: "actor", kind: "unknown" },
      renderImage,
      render: { width: 160, height: 80, allowImageUrl: () => false },
    });
    return { thread, session, packets };
  }

  const snapshot = () =>
    jsx("div", {
      style: { width: "100%", height: "100%", backgroundColor: "#5533cc" },
      children: "Preview",
    });
  const mixed = () =>
    Message({
      children: [
        Header({ children: "Weekly report" }),
        Carousel({
          children: [
            CarouselCard({
              children: [
                Render({ alt: "Preview", children: snapshot() }),
                Button({ children: "Approve", onClick: async () => {} }),
              ],
            }),
          ],
        }),
      ],
    });

  it.each(["slack", "teams"] as const)(
    "renders real PNGs in managed %s cards and updates",
    async (provider) => {
      const { thread, session, packets } = setup(provider);
      const ref = await thread.post(mixed());
      await thread.update(ref, mixed());
      expect(packets.map((p) => p.kind)).toEqual([
        `${provider}.message.create`,
        `${provider}.message.replace`,
      ]);
      expect(JSON.stringify(packets)).toContain("Approve");
      expect(JSON.stringify(packets)).toContain(
        provider === "slack" ? "slack_file" : "data:image/png;base64,iVBOR",
      );
      expect(JSON.stringify(packets)).toContain(
        provider === "slack" ? "action_id" : "Action.Submit",
      );
      if (provider === "slack") {
        expect(session.uploadFile).toHaveBeenCalledTimes(2);
        const bytes = vi.mocked(session.uploadFile).mock.calls[0]![1].bytes;
        expect(Array.from(bytes.subarray(0, 8))).toEqual([
          137, 80, 78, 71, 13, 10, 26, 10,
        ]);
        expect(JSON.stringify(packets)).toContain(
          "fileref_managed_snapshot_01",
        );
      } else {
        expect(session.uploadFile).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["slack", "teams"] as const)(
    "keeps large standalone %s snapshots out of packets",
    async (provider) => {
      const png = new Uint8Array(96 * 1024);
      png.set([137, 80, 78, 71, 13, 10, 26, 10]);
      const { thread, session, packets } = setup(provider, async () => png);
      await thread.post(snapshot());
      expect(session.uploadFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ bytes: png, filename: "image.png" }),
      );
      expect(packets).toEqual([
        expect.objectContaining({
          kind:
            provider === "slack" ? "slack.file.create" : "teams.image.create",
          fileHandle: "fileref_managed_snapshot_01",
        }),
      ]);
      expect(JSON.stringify(packets)).not.toContain("base64");
    },
  );

  it("rejects oversized Teams card packets before sending and allows a text fallback", async () => {
    const { thread, packets } = setup(
      "teams",
      async () => new Uint8Array(50 * 1024),
    );
    await expect(thread.post(mixed())).rejects.toThrow(/64 KiB.*thread.post/);
    expect(packets).toEqual([]);
    await thread.post("Snapshot too large; here is the summary.");
    expect(packets).toEqual([
      {
        kind: "teams.message.create",
        text: "Snapshot too large; here is the summary.",
      },
    ]);
  });

  it("does not silently post a Slack card when upload staging fails", async () => {
    const { thread, session, packets } = setup(
      "slack",
      async () => new Uint8Array([1]),
    );
    vi.mocked(session.uploadFile).mockRejectedValue(new Error("upload failed"));
    await expect(thread.post(mixed())).rejects.toThrow("upload failed");
    expect(packets).toEqual([]);
  });
});
