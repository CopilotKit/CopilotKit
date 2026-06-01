import { describe, it, expect } from "vitest";
import { createEventBus } from "./event-bus.js";

describe("event-bus", () => {
  it("emits and receives typed events", () => {
    const bus = createEventBus();
    const received: string[] = [];
    bus.on("rules.reloaded", (p) => {
      received.push(`count=${p.count}`);
    });
    bus.emit("rules.reloaded", { count: 3 });
    bus.emit("rules.reloaded", { count: 5 });
    expect(received).toEqual(["count=3", "count=5"]);
  });

  it("unsubscribe removes listener", () => {
    const bus = createEventBus();
    let hits = 0;
    const unsub = bus.on("rules.reloaded", () => {
      hits += 1;
    });
    bus.emit("rules.reloaded", { count: 1 });
    unsub();
    bus.emit("rules.reloaded", { count: 1 });
    expect(hits).toBe(1);
  });

  it("isolates subscriber errors: a throwing handler does not prevent later handlers from running", () => {
    const bus = createEventBus();
    let hitB = 0;
    // Register the throwing subscriber FIRST so there's something downstream
    // that depends on the throw being swallowed. Without error isolation,
    // Node's EventEmitter re-throws and halts dispatch on the current emit.
    bus.on("rules.reloaded", () => {
      throw new Error("boom");
    });
    bus.on("rules.reloaded", () => {
      hitB += 1;
    });
    // emit must not throw — the bus wraps each handler in try/catch.
    expect(() => bus.emit("rules.reloaded", { count: 1 })).not.toThrow();
    // The downstream subscriber must still have run.
    expect(hitB).toBe(1);
  });

  it("unsubscribe returned from on() removes the wrapped listener (not the raw handler)", () => {
    // Regression: previously `off()` tried to remove the caller's handler
    // reference, but `on()` registers a wrapper closure for error isolation.
    // The returned unsubscribe function is the canonical way to detach.
    const bus = createEventBus();
    let hits = 0;
    const unsub = bus.on("rules.reloaded", () => {
      hits += 1;
    });
    bus.emit("rules.reloaded", { count: 1 });
    unsub();
    bus.emit("rules.reloaded", { count: 2 });
    bus.emit("rules.reloaded", { count: 3 });
    expect(hits).toBe(1);
  });
});
