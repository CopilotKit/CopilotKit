import { AbstractAgent } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { EMPTY } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { DeliveryAdapter } from "./delivery-adapter.js";
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
        operation: {
          kind: "created",
          logicalMessageId: "message-postfile",
          revisionId: "revision-postfile",
          mentioned: false,
        },
      },
      actor: { externalUserId: "U1" },
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
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: "ACTIVITY_SNAPSHOT",
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
    expect(JSON.stringify(onEvent.mock.calls)).not.toContain("iVBOR");
    await agentSession.release?.();
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
});
