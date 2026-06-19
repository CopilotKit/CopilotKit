import { describe, it, expect, vi } from "vitest";
import { McpManager } from "./manager";
import type { McpServerConfig } from "./config";

// ---------------------------------------------------------------------------
// Fully-mocked connector — NO real spawn/network. Each test builds its own
// fakeClient/connect so spy state is isolated.
// ---------------------------------------------------------------------------

function makeFake() {
  const fakeClient = {
    tools: vi.fn().mockResolvedValue({ echo: { description: "echo tool" } }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  // Cast through unknown: the fake only implements the slice of MCPClient the
  // manager actually touches (tools/close).
  const connect = vi.fn().mockResolvedValue(fakeClient);
  return {
    fakeClient,
    connect: connect as unknown as ConstructorParameters<typeof McpManager>[1],
  };
}

const stdioCfg = (name: string): McpServerConfig => ({
  name,
  kind: "stdio",
  command: "noop",
});

describe("McpManager — connectAll", () => {
  it("connect → exposes the client's tools (ready, toolNames, provider.tools())", async () => {
    const { connect } = makeFake();
    const mgr = new McpManager([stdioCfg("alpha")], connect);

    await mgr.connectAll();

    const [status] = mgr.getStatuses();
    expect(status.status).toBe("ready");
    expect(status.toolNames).toContain("echo");

    const [provider] = mgr.getProviders();
    const tools = await provider.tools();
    expect(Object.keys(tools)).toContain("echo");
  });

  it("a disabled server's provider.tools() returns {} even when a client exists", async () => {
    const { connect } = makeFake();
    const mgr = new McpManager([stdioCfg("alpha")], connect);

    await mgr.connectAll();
    // Client now exists & is ready; disable it.
    mgr.setEnabled("alpha", false);

    const [provider] = mgr.getProviders();
    const tools = await provider.tools();
    expect(Object.keys(tools)).toHaveLength(0);

    const [status] = mgr.getStatuses();
    expect(status.status).toBe("disabled");
    expect(status.enabled).toBe(false);
  });

  it("a server that starts disabled is never connected (stays 'disabled', connect not called)", async () => {
    const { connect } = makeFake();
    const disabledCfg: McpServerConfig = {
      ...stdioCfg("alpha"),
      enabled: false,
    };
    const mgr = new McpManager([disabledCfg], connect);

    await mgr.connectAll();

    expect(connect).not.toHaveBeenCalled();
    const [status] = mgr.getStatuses();
    expect(status.status).toBe("disabled");
    expect(status.enabled).toBe(false);
    expect(status.toolNames).toHaveLength(0);
  });

  it("a failed connection → status 'error', connectAll does not throw, log captured", async () => {
    const connect = vi
      .fn()
      .mockRejectedValue(new Error("boom")) as unknown as ConstructorParameters<
      typeof McpManager
    >[1];
    const mgr = new McpManager([stdioCfg("alpha")], connect);

    await expect(mgr.connectAll()).resolves.toBeUndefined();

    const [status] = mgr.getStatuses();
    expect(status.status).toBe("error");
    expect(status.logs.some((l) => l.includes("boom"))).toBe(true);
  });

  it("a post-connect tools() rejection → provider.tools() resolves to {} (no throw) and status becomes 'error'", async () => {
    // Resolve the first tools() call (during connectAll) so the server reaches
    // "ready", then reject on the later provider call (server dropped).
    const tools = vi
      .fn()
      .mockResolvedValueOnce({ echo: { description: "echo tool" } })
      .mockRejectedValue(new Error("session expired"));
    const fakeClient = { tools, close: vi.fn().mockResolvedValue(undefined) };
    const connect = vi
      .fn()
      .mockResolvedValue(fakeClient) as unknown as ConstructorParameters<
      typeof McpManager
    >[1];
    const mgr = new McpManager([stdioCfg("alpha")], connect);

    await mgr.connectAll();
    expect(mgr.getStatuses()[0].status).toBe("ready");

    const [provider] = mgr.getProviders();
    // The runtime tools() call now rejects — must degrade, not throw.
    await expect(provider.tools()).resolves.toEqual({});

    const [status] = mgr.getStatuses();
    expect(status.status).toBe("error");
    expect(status.logs.some((l) => l.includes("session expired"))).toBe(true);
  });

  it("closeAll() calls each client's close()", async () => {
    const { fakeClient: a, connect: connectA } = makeFake();
    const { fakeClient: b } = makeFake();
    // One connect fn serving two servers, returning a then b.
    const connect = vi
      .fn()
      .mockResolvedValueOnce(a)
      .mockResolvedValueOnce(b) as unknown as typeof connectA;
    const mgr = new McpManager([stdioCfg("alpha"), stdioCfg("beta")], connect);

    await mgr.connectAll();
    await mgr.closeAll();

    expect(a.close).toHaveBeenCalledTimes(1);
    expect(b.close).toHaveBeenCalledTimes(1);
  });

  it("getProviders() returns stable refs across a setEnabled toggle", async () => {
    const { connect } = makeFake();
    const mgr = new McpManager([stdioCfg("alpha")], connect);

    const before = mgr.getProviders()[0];
    mgr.setEnabled("alpha", false);
    const afterOff = mgr.getProviders()[0];
    mgr.setEnabled("alpha", true);
    const afterOn = mgr.getProviders()[0];

    expect(afterOff).toBe(before);
    expect(afterOn).toBe(before);
  });
});
