import { describe, it, expect, vi } from "vitest";
import { withTelegramFormatFallback, stripHtml } from "../format-fallback.js";

describe("withTelegramFormatFallback", () => {
  it("retries as plain text on a parse error", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Bad Request: can't parse entities: bad tag"),
      )
      .mockResolvedValueOnce("ok");
    const r = await withTelegramFormatFallback(send, "<b>x</b>");
    expect(r).toBe("ok");
    expect(send).toHaveBeenLastCalledWith({ text: "x" });
  });
  it("retries as plain text on 'unsupported start tag' error", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('Bad Request: unsupported start tag "x"'),
      )
      .mockResolvedValueOnce("ok");
    const r = await withTelegramFormatFallback(send, "<x>hello</x>");
    expect(r).toBe("ok");
    expect(send).toHaveBeenLastCalledWith({ text: "hello" });
  });
  it("retries as plain text on 'can\\'t find end tag' error", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Bad Request: can't find end tag corresponding to start tag"),
      )
      .mockResolvedValueOnce("ok");
    const r = await withTelegramFormatFallback(send, "<b>hello");
    expect(r).toBe("ok");
    expect(send).toHaveBeenLastCalledWith({ text: "hello" });
  });
  it("retries as plain text on 'tag is not allowed' error", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Bad Request: tag script is not allowed"),
      )
      .mockResolvedValueOnce("ok");
    const r = await withTelegramFormatFallback(send, "<script>x</script>");
    expect(r).toBe("ok");
    expect(send).toHaveBeenLastCalledWith({ text: "x" });
  });
  it("rethrows non-parse errors", async () => {
    const send = vi.fn().mockRejectedValue(new Error("chat not found"));
    await expect(withTelegramFormatFallback(send, "<b>x</b>")).rejects.toThrow(
      "chat not found",
    );
  });
  it("strips tags", () => {
    expect(stripHtml("<b>a</b> &amp; b")).toBe("a & b");
  });
});
