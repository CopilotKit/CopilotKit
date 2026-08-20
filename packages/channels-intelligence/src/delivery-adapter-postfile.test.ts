import { AbstractAgent } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { EMPTY } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { ChannelDeliveryTerminatedError } from "@copilotkit/channels-core";
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

describe("DeliveryAdapter.stageFile", () => {
  it("stores Slack bytes and returns the handle without posting a file", async () => {
    const session = {
      uploadFile: vi.fn().mockResolvedValue("fileref_stage_01"),
      effect: vi.fn(),
    } as unknown as ClaimedChannelDelivery;

    await expect(
      makeAdapter().stageFile(replyTarget(session), {
        bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        filename: "hat.png",
        altText: "Hat",
      }),
    ).resolves.toEqual({ fileId: "fileref_stage_01" });
    expect(session.uploadFile).toHaveBeenCalledWith(
      expect.stringMatching(/^response_/),
      {
        bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        filename: "hat.png",
        altText: "Hat",
      },
    );
    expect(session.effect).not.toHaveBeenCalled();
  });

  it("throws when Slack upload fails so the carousel post cannot continue", async () => {
    const session = {
      uploadFile: vi.fn().mockRejectedValue(new Error("upload config missing")),
      effect: vi.fn(),
    } as unknown as ClaimedChannelDelivery;

    await expect(
      makeAdapter().stageFile(replyTarget(session), {
        bytes: new Uint8Array([1]),
        filename: "hat.png",
        altText: "Hat",
      }),
    ).rejects.toThrow("upload config missing");
    expect(session.effect).not.toHaveBeenCalled();
  });

  it("throws when Slack upload returns no handle", async () => {
    const session = {
      uploadFile: vi.fn().mockResolvedValue(""),
      effect: vi.fn(),
    } as unknown as ClaimedChannelDelivery;

    await expect(
      makeAdapter().stageFile(replyTarget(session), {
        bytes: new Uint8Array([1]),
        filename: "hat.png",
        altText: "Hat",
      }),
    ).rejects.toThrow("Channel stageFile: upload returned no handle");
    expect(session.effect).not.toHaveBeenCalled();
  });

  it("returns a Teams data URI and does not upload or post", async () => {
    const session = {
      uploadFile: vi.fn(),
      effect: vi.fn(),
    } as unknown as ClaimedChannelDelivery;
    const bytes = new Uint8Array([1, 2, 3]);

    await expect(
      makeAdapter().stageFile(replyTarget(session, "teams"), {
        bytes,
        filename: "hat.png",
        altText: "Hat",
      }),
    ).resolves.toEqual({
      dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
    });
    expect(session.uploadFile).not.toHaveBeenCalled();
    expect(session.effect).not.toHaveBeenCalled();
  });
});
