import { afterEach, describe, expect, it, vi } from "vitest";
import { createChannel } from "@copilotkit/channels-core";
import { whatsapp } from "./adapter.js";

function createWhatsAppChannel() {
  const adapter = whatsapp({
    accessToken: "TOK",
    phoneNumberId: "PNID",
    appSecret: "SECRET",
    verifyToken: "VTOK",
    port: 0,
  });
  const start = vi.spyOn(adapter, "start");
  const channel = createChannel({
    identifyUser: "platform",
    name: "whatsapp-support",
    adapters: [adapter],
  });
  return { channel, start };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WhatsApp activation message handlers", () => {
  it("rejects missing message handlers before the real listener starts", async () => {
    const { channel, start } = createWhatsAppChannel();
    try {
      await expect(channel.ɵruntime.start()).rejects.toThrow(
        'channel "whatsapp-support" must register onMention or onMessage before activation',
      );
      expect(start).not.toHaveBeenCalled();
    } finally {
      await channel.ɵruntime.stop();
    }
  });

  it.each(["onMention", "onMessage"] as const)(
    "allows activation with only %s registered",
    async (handler) => {
      const { channel, start } = createWhatsAppChannel();
      channel[handler](() => {});
      try {
        await expect(channel.ɵruntime.start()).resolves.toBeUndefined();
        expect(start).toHaveBeenCalledOnce();
      } finally {
        await channel.ɵruntime.stop();
      }
    },
  );
});
