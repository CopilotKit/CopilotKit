// src/main/bridge/server.test.ts
import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { BridgeServer } from "./server";

// A fake socket: records sends, lets the test emit inbound frames + close.
class FakeSocket extends EventEmitter {
  sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
    this.emit("close");
  }
}

// A fake WebSocketServer: captures the connection handler so the test can
// simulate an incoming socket + request URL.
class FakeWss extends EventEmitter {
  connect(socket: FakeSocket, url: string) {
    this.emit("connection", socket, { url });
  }
  close(cb?: () => void) {
    cb?.();
  }
}

function makeServer(token = "tok-123", timeoutMs = 50) {
  const wss = new FakeWss();
  const server = new BridgeServer({
    token,
    timeoutMs,
    // createWss returns our fake + a fixed port; never opens a real socket.
    createWss: async () => ({ wss: wss as never, port: 4555 }),
  });
  return { server, wss };
}

describe("BridgeServer", () => {
  it("reports the port from start() and is not connected initially", async () => {
    const { server } = makeServer();
    const { port } = await server.start();
    expect(port).toBe(4555);
    expect(server.isConnected()).toBe(false);
    await server.close();
  });

  it("accepts a socket with the correct token and round-trips a request", async () => {
    const { server, wss } = makeServer();
    await server.start();
    const socket = new FakeSocket();
    wss.connect(socket, "/?token=tok-123");
    expect(server.isConnected()).toBe(true);

    const pending = server.request("readActiveTab", {});
    // The server sent a request frame; reply with the matching id.
    const sent = JSON.parse(socket.sent[0]) as { id: string; method: string };
    expect(sent.method).toBe("readActiveTab");
    socket.emit(
      "message",
      JSON.stringify({
        type: "result",
        id: sent.id,
        data: { url: "https://x" },
      }),
    );
    await expect(pending).resolves.toEqual({ url: "https://x" });
    await server.close();
  });

  it("rejects a socket with a wrong token (closed, never registered)", async () => {
    const { server, wss } = makeServer();
    await server.start();
    const socket = new FakeSocket();
    wss.connect(socket, "/?token=WRONG");
    expect(socket.closed?.code).toBe(1008);
    expect(server.isConnected()).toBe(false);
    await server.close();
  });

  it("rejects a socket with no token", async () => {
    const { server, wss } = makeServer();
    await server.start();
    const socket = new FakeSocket();
    wss.connect(socket, "/");
    expect(socket.closed?.code).toBe(1008);
    expect(server.isConnected()).toBe(false);
    await server.close();
  });

  it("request() rejects with a clear error when no extension is connected", async () => {
    const { server } = makeServer();
    await server.start();
    await expect(server.request("readActiveTab", {})).rejects.toThrow(
      /no browser connected/i,
    );
    await server.close();
  });

  it("request() rejects after the timeout when no reply arrives", async () => {
    vi.useFakeTimers();
    const { server, wss } = makeServer("tok-123", 50);
    await server.start();
    const socket = new FakeSocket();
    wss.connect(socket, "/?token=tok-123");
    const pending = server.request("readActiveTab", {});
    vi.advanceTimersByTime(60);
    await expect(pending).rejects.toThrow(/timed out/i);
    vi.useRealTimers();
    await server.close();
  });

  it("replies to a ping with a pong", async () => {
    const { server, wss } = makeServer();
    await server.start();
    const socket = new FakeSocket();
    wss.connect(socket, "/?token=tok-123");
    socket.emit("message", JSON.stringify({ type: "ping" }));
    expect(socket.sent.some((s) => s.includes("pong"))).toBe(true);
    await server.close();
  });
});
