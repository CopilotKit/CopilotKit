import { describe, it, expect, vi, afterEach } from "vitest";
import { installFetchInterceptor } from "../fetch-interceptor";

describe("installFetchInterceptor", () => {
  const origFetch = global.fetch;
  afterEach(() => {
    global.fetch = origFetch;
  });

  it("noops configured URL prefixes", async () => {
    const spy = vi.fn();
    global.fetch = spy;
    installFetchInterceptor(["https://mock.local"]);
    const res = await fetch("https://mock.local/chat");
    expect(await res.text()).toBe("{}");
    expect(spy).not.toHaveBeenCalled();
  });

  it("passes through other URLs", async () => {
    const spy = vi.fn(async () => new Response("ok"));
    global.fetch = spy as any;
    installFetchInterceptor(["https://mock.local"]);
    const res = await fetch("https://api.example.com");
    expect(spy).toHaveBeenCalled();
    expect(await res.text()).toBe("ok");
  });
});
