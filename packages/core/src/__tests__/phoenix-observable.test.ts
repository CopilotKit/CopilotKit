import { describe, expect, it, vi } from "vitest";
import { Subject } from "rxjs";
import { MockSocket } from "./test-utils";

const phoenix = vi.hoisted(() => ({
  sockets: [] as MockSocket[],
}));

vi.mock("phoenix", () => ({
  Socket: class extends MockSocket {
    constructor(url = "", opts: Record<string, any> = {}) {
      super(url, opts);
      phoenix.sockets.push(this);
    }
  },
}));

const {
  ɵobservePhoenixEvent$,
  ɵobservePhoenixSocketHealth$,
  ɵobservePhoenixSocketSignals$,
  ɵphoenixChannel$,
  ɵphoenixSocket$,
} = await import("../utils/phoenix-observable");

type PhoenixSocketSession =
  import("../utils/phoenix-observable").ɵPhoenixSocketSession;

describe("phoenix observable utilities", () => {
  it("connects on subscribe and disconnects on teardown", () => {
    phoenix.sockets.splice(0);
    const socket$ = ɵphoenixSocket$({
      url: "ws://localhost:4000/client",
    });

    let socket = null as MockSocket | null;
    const subscription = socket$.subscribe({
      next: (session) => {
        socket = session.socket as MockSocket;
      },
    });

    expect(socket).not.toBeNull();
    expect(socket!.connected).toBe(true);

    subscription.unsubscribe();

    expect(socket!.disconnected).toBe(true);
  });

  it("joins channels automatically and leaves on teardown", () => {
    phoenix.sockets.splice(0);
    const socket$ = ɵphoenixSocket$({
      url: "ws://localhost:4000/client",
    });
    const channel$ = ɵphoenixChannel$({
      socket$,
      topic: "room:lobby",
      params: { mode: "test" },
    });

    let channel = null as MockSocket["channels"][number] | null;
    let joinOutcome: string | null = null;
    const subscription = channel$.subscribe({
      next: (session) => {
        channel = session.channel as MockSocket["channels"][number];
        session.joinOutcome$.subscribe((outcome) => {
          joinOutcome = outcome.type;
        });
      },
    });

    expect(channel).not.toBeNull();
    expect(channel!.topic).toBe("room:lobby");
    expect(channel!.params).toEqual({ mode: "test" });

    channel!.triggerJoin("ok");
    expect(joinOutcome).toBe("joined");

    subscription.unsubscribe();

    expect(channel!.left).toBe(true);
    expect(phoenix.sockets[0].disconnected).toBe(true);
  });

  it("removes channel event listeners on unsubscribe", () => {
    phoenix.sockets.splice(0);
    const socket$ = ɵphoenixSocket$({
      url: "ws://localhost:4000/client",
    });
    const channel$ = ɵphoenixChannel$({
      socket$,
      topic: "room:lobby",
    });

    const payloads: string[] = [];
    const channelSubscription = channel$.subscribe();
    const channel = phoenix.sockets[0].channels[0];
    channel.triggerJoin("ok");

    const eventSubscription = ɵobservePhoenixEvent$<{ value: string }>(
      channel,
      "message",
    ).subscribe((payload) => {
      payloads.push(payload.value);
    });

    channel.serverPush("message", { value: "first" });
    eventSubscription.unsubscribe();
    channel.serverPush("message", { value: "second" });
    channelSubscription.unsubscribe();

    expect(payloads).toEqual(["first"]);
  });

  it("leaves the previous channel when the socket session switches", () => {
    const socketSessions$ = new Subject<PhoenixSocketSession>();
    const firstSocket = new MockSocket("ws://localhost:4000/first");
    const secondSocket = new MockSocket("ws://localhost:4000/second");
    const channel$ = ɵphoenixChannel$({
      socket$: socketSessions$,
      topic: "room:lobby",
    });

    const subscription = channel$.subscribe();

    socketSessions$.next({
      socket: firstSocket,
      signals$: new Subject(),
    });
    const firstChannel = firstSocket.channels[0];

    socketSessions$.next({
      socket: secondSocket,
      signals$: new Subject(),
    });
    const secondChannel = secondSocket.channels[0];

    expect(firstChannel.left).toBe(true);
    expect(secondChannel.left).toBe(false);

    subscription.unsubscribe();

    expect(secondChannel.left).toBe(true);
  });

  it("fails health after consecutive socket errors and resets after open", () => {
    phoenix.sockets.splice(0);
    const socket$ = ɵphoenixSocket$({
      url: "ws://localhost:4000/client",
    });

    let error: Error | null = null;
    const subscription = ɵobservePhoenixSocketHealth$(
      ɵobservePhoenixSocketSignals$(socket$),
      2,
    ).subscribe({
      error: (value) => {
        error = value;
      },
    });

    const socket = phoenix.sockets[0];
    socket.triggerError(new Error("first"));
    socket.triggerOpen();
    socket.triggerError(new Error("second"));
    expect(error).toBeNull();

    socket.triggerError(new Error("third"));
    expect(error?.message).toContain("2 consecutive errors");

    subscription.unsubscribe();
  });
});
