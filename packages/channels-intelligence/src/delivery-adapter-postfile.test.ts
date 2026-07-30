import { describe, expect, it, vi } from "vitest";
import { DeliveryAdapter } from "./delivery-adapter.js";
import { ChannelProviderDeliveryError } from "./delivery-transport.js";
import type {
  ChannelDeliverySession,
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
      input: { kind: "text", text: "hi" },
      actor: { externalUserId: "U1" },
    },
  };
}

function replyTarget(session: ChannelDeliverySession) {
  return { session, delivery: prepared() };
}

function makeAdapter() {
  return new DeliveryAdapter({
    transport: {} as never,
    runCanonical: async () => ({ iterations: 0, interrupted: false }),
    loadHistory: async () => [],
  });
}

describe("DeliveryAdapter.postFile", () => {
  it("soft-returns upload failures without throwing", async () => {
    const session = {
      uploadFile: vi.fn().mockRejectedValue(new Error("upload config missing")),
      effect: vi.fn(),
    } as unknown as ChannelDeliverySession;
    const adapter = makeAdapter();

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
    } as unknown as ChannelDeliverySession;
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
        } as unknown as ChannelDeliverySession),
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
        } as unknown as ChannelDeliverySession),
        { bytes: new Uint8Array([1]), filename: "a.png" },
      ),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("returns ok after a successful file create effect", async () => {
    const session = {
      uploadFile: vi.fn().mockResolvedValue("file_handle_01"),
      effect: vi.fn().mockResolvedValue({}),
    } as unknown as ChannelDeliverySession;
    const adapter = makeAdapter();

    await expect(
      adapter.postFile(replyTarget(session), {
        bytes: new Uint8Array([1]),
        filename: "a.png",
        title: "chart",
      }),
    ).resolves.toEqual({ ok: true, fileId: "file_handle_01" });
    expect(session.effect).toHaveBeenCalledWith(
      expect.stringMatching(/^response_/),
      expect.objectContaining({
        kind: "slack.file.create",
        fileHandle: "file_handle_01",
        title: "chart",
      }),
    );
  });
});
