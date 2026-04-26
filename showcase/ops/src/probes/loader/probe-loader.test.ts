import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createProbeLoader } from "./probe-loader.js";
import { createProbeRegistry } from "../drivers/index.js";
import { createDiscoveryRegistry } from "../discovery/index.js";
import { z } from "zod";
import type { DiscoverySource, ProbeDriver } from "../types.js";
import { logger } from "../../logger.js";

// Mock chokidar with an in-memory EventEmitter so watch() tests are
// deterministic. Real chokidar's macOS fsevents latency makes timing-
// based assertions flaky (see rule-loader.test.ts for the same pattern,
// where the real-watcher path was abandoned for the same reason).
// The mock preserves the chokidar.watch() return shape we depend on:
// `.on(event, cb)` and `.close()`.
const watchers: MockWatcher[] = [];
class MockWatcher extends EventEmitter {
  closed = false;
  close(): Promise<void> {
    this.closed = true;
    this.removeAllListeners();
    return Promise.resolve();
  }
}
vi.mock("chokidar", () => ({
  default: {
    watch: () => {
      const w = new MockWatcher();
      watchers.push(w);
      return w;
    },
  },
}));

interface Emitted {
  event: string;
  payload: unknown;
}

function mkBus(): { emit: (e: string, p: unknown) => void; events: Emitted[] } {
  const events: Emitted[] = [];
  return {
    events,
    emit(event, payload) {
      events.push({ event, payload });
    },
  };
}

function mkDriver(kind: string): ProbeDriver {
  return {
    kind,
    inputSchema: z.object({ key: z.string() }).passthrough(),
    async run(ctx, input) {
      return {
        key: (input as { key: string }).key,
        state: "green",
        signal: {},
        observedAt: ctx.now().toISOString(),
      };
    },
  };
}

function mkSource(name: string): DiscoverySource {
  return {
    name,
    configSchema: z.object({}).passthrough(),
    async enumerate() {
      return [];
    },
  };
}

describe("createProbeLoader", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "probe-loader-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("loads valid YAML files into ProbeConfig[] (both .yml and .yaml)", async () => {
    await fs.writeFile(
      path.join(dir, "a.yml"),
      [
        "kind: smoke",
        "id: smoke-a",
        'schedule: "*/15 * * * *"',
        "targets:",
        '  - { key: "smoke:a", url: "https://a.example" }',
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(
      path.join(dir, "b.yaml"),
      [
        "kind: pin_drift",
        "id: pin-drift",
        'schedule: "0 10 * * 1"',
        "target:",
        '  key: "pin_drift:overall"',
      ].join("\n"),
      "utf-8",
    );
    const probeRegistry = createProbeRegistry();
    probeRegistry.register(mkDriver("smoke"));
    probeRegistry.register(mkDriver("pin_drift"));
    const discoveryRegistry = createDiscoveryRegistry();
    const bus = mkBus();
    const loader = createProbeLoader(dir, {
      probeRegistry,
      discoveryRegistry,
      bus,
      logger,
    });
    const configs = await loader.load();
    expect(configs.map((c) => c.id).sort()).toEqual(["pin-drift", "smoke-a"]);
  });

  it("emits probes.reload.failed on malformed YAML + peer files still load", async () => {
    await fs.writeFile(
      path.join(dir, "bad.yml"),
      ": : :\nnot valid\n",
      "utf-8",
    );
    await fs.writeFile(
      path.join(dir, "good.yml"),
      [
        "kind: smoke",
        "id: smoke-good",
        'schedule: "*/15 * * * *"',
        "targets:",
        '  - { key: "smoke:good", url: "https://good.example" }',
      ].join("\n"),
      "utf-8",
    );
    const probeRegistry = createProbeRegistry();
    probeRegistry.register(mkDriver("smoke"));
    const bus = mkBus();
    const loader = createProbeLoader(dir, {
      probeRegistry,
      discoveryRegistry: createDiscoveryRegistry(),
      bus,
      logger,
    });
    const configs = await loader.load();
    expect(configs.map((c) => c.id)).toEqual(["smoke-good"]);
    const failed = bus.events.find((e) => e.event === "probes.reload.failed");
    expect(failed).toBeDefined();
    expect(
      (
        failed!.payload as { errors: { file: string; error: string }[] }
      ).errors.some((e) => e.file === "bad.yml"),
    ).toBe(true);
  });

  it("emits probes.reload.failed on Zod schema violation", async () => {
    await fs.writeFile(
      path.join(dir, "bad.yml"),
      ["kind: smoke", "id: bad", 'schedule: "*/15 * * * *"'].join("\n"),
      "utf-8",
    );
    const probeRegistry = createProbeRegistry();
    probeRegistry.register(mkDriver("smoke"));
    const bus = mkBus();
    const loader = createProbeLoader(dir, {
      probeRegistry,
      discoveryRegistry: createDiscoveryRegistry(),
      bus,
      logger,
    });
    const configs = await loader.load();
    expect(configs).toEqual([]);
    expect(bus.events.some((e) => e.event === "probes.reload.failed")).toBe(
      true,
    );
  });

  it("rejects unknown kind via schema (not in DIMENSIONS)", async () => {
    await fs.writeFile(
      path.join(dir, "bad.yml"),
      [
        "kind: totally_made_up_kind",
        "id: bad",
        'schedule: "*/15 * * * *"',
        "target: { key: 'bad:overall' }",
      ].join("\n"),
      "utf-8",
    );
    const probeRegistry = createProbeRegistry();
    const bus = mkBus();
    const loader = createProbeLoader(dir, {
      probeRegistry,
      discoveryRegistry: createDiscoveryRegistry(),
      bus,
      logger,
    });
    const configs = await loader.load();
    expect(configs).toEqual([]);
    expect(bus.events.some((e) => e.event === "probes.reload.failed")).toBe(
      true,
    );
  });

  it("rejects a config whose kind has no registered driver", async () => {
    await fs.writeFile(
      path.join(dir, "unregistered.yml"),
      [
        "kind: smoke",
        "id: smoke-orphan",
        'schedule: "*/15 * * * *"',
        "targets: [{ key: 'smoke:orphan', url: 'https://x.example' }]",
      ].join("\n"),
      "utf-8",
    );
    const probeRegistry = createProbeRegistry();
    // NOTE: no drivers registered
    const bus = mkBus();
    const loader = createProbeLoader(dir, {
      probeRegistry,
      discoveryRegistry: createDiscoveryRegistry(),
      bus,
      logger,
    });
    const configs = await loader.load();
    expect(configs).toEqual([]);
    expect(bus.events.some((e) => e.event === "probes.reload.failed")).toBe(
      true,
    );
  });

  it("rejects a discovery config whose source isn't registered", async () => {
    await fs.writeFile(
      path.join(dir, "d.yml"),
      [
        "kind: image_drift",
        "id: image-drift",
        'schedule: "*/15 * * * *"',
        "discovery:",
        "  source: nonexistent-source",
        "  filter: {}",
        '  key_template: "image_drift:${name}"',
      ].join("\n"),
      "utf-8",
    );
    const probeRegistry = createProbeRegistry();
    probeRegistry.register(mkDriver("image_drift"));
    const discoveryRegistry = createDiscoveryRegistry();
    const bus = mkBus();
    const loader = createProbeLoader(dir, {
      probeRegistry,
      discoveryRegistry,
      bus,
      logger,
    });
    const configs = await loader.load();
    expect(configs).toEqual([]);
    expect(bus.events.some((e) => e.event === "probes.reload.failed")).toBe(
      true,
    );
  });

  it("accepts a discovery config when source IS registered", async () => {
    await fs.writeFile(
      path.join(dir, "d.yml"),
      [
        "kind: image_drift",
        "id: image-drift",
        'schedule: "*/15 * * * *"',
        "discovery:",
        "  source: railway-services",
        "  filter: {}",
        '  key_template: "image_drift:${name}"',
      ].join("\n"),
      "utf-8",
    );
    const probeRegistry = createProbeRegistry();
    probeRegistry.register(mkDriver("image_drift"));
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(mkSource("railway-services"));
    const bus = mkBus();
    const loader = createProbeLoader(dir, {
      probeRegistry,
      discoveryRegistry,
      bus,
      logger,
    });
    const configs = await loader.load();
    expect(configs.map((c) => c.id)).toEqual(["image-drift"]);
  });

  it("fires watch callback on file add/change/unlink", async () => {
    // Real chokidar timing on macOS is not deterministic enough for a
    // 500ms-after-write assertion (the prior version of this test was
    // failing 5/5 runs locally). Mock chokidar (top of file) gives us
    // an EventEmitter we drive directly, so the assertion exercises
    // the trigger → debounce(100ms) → loadInternal → callback wiring
    // without depending on fsevents latency. Same rationale as rule-
    // loader.test.ts, which gave up on real-chokidar tests entirely.
    watchers.length = 0;
    const probeRegistry = createProbeRegistry();
    probeRegistry.register(mkDriver("smoke"));
    const bus = mkBus();
    const loader = createProbeLoader(dir, {
      probeRegistry,
      discoveryRegistry: createDiscoveryRegistry(),
      bus,
      logger,
    });

    let lastConfigs: unknown[] = [];
    let callCount = 0;
    const callbackFired = new Promise<void>((resolve) => {
      const unwatch = loader.watch((configs) => {
        lastConfigs = configs;
        callCount++;
        resolve();
        // Hold a reference so closure isn't GC'd before assert; unsub
        // is called in afterEach via watcher.close (mock).
        void unwatch;
      });
    });

    expect(watchers.length).toBe(1);
    const w = watchers[0]!;

    // Write the file first so loadInternal() (called after debounce)
    // observes it on the real fs — the mock only stands in for
    // chokidar's event delivery, not the fs read.
    await fs.writeFile(
      path.join(dir, "new.yml"),
      [
        "kind: smoke",
        "id: smoke-new",
        'schedule: "*/15 * * * *"',
        "targets: [{ key: 'smoke:new', url: 'https://new.example' }]",
      ].join("\n"),
      "utf-8",
    );

    // Drive the synthetic chokidar event — this is what the real
    // watcher would emit on file creation.
    w.emit("add", path.join(dir, "new.yml"));

    await callbackFired;

    expect(callCount).toBeGreaterThan(0);
    expect(
      (lastConfigs as { id: string }[]).some((c) => c.id === "smoke-new"),
    ).toBe(true);
  });

  it("debounces rapid add/change/unlink bursts into a single reload", async () => {
    // Reload-debounce contract: 100ms timer is reset on each event so a
    // burst (e.g. editor-save fan-out + atomic rename) collapses to one
    // load. Drive three events back-to-back through the mock and assert
    // the callback fires exactly once.
    watchers.length = 0;
    const probeRegistry = createProbeRegistry();
    probeRegistry.register(mkDriver("smoke"));
    const bus = mkBus();
    const loader = createProbeLoader(dir, {
      probeRegistry,
      discoveryRegistry: createDiscoveryRegistry(),
      bus,
      logger,
    });

    let callCount = 0;
    const fired = new Promise<void>((resolve) => {
      loader.watch(() => {
        callCount++;
        resolve();
      });
    });

    expect(watchers.length).toBe(1);
    const w = watchers[0]!;
    await fs.writeFile(
      path.join(dir, "burst.yml"),
      [
        "kind: smoke",
        "id: smoke-burst",
        'schedule: "*/15 * * * *"',
        "targets: [{ key: 'smoke:burst', url: 'https://burst.example' }]",
      ].join("\n"),
      "utf-8",
    );
    w.emit("add", path.join(dir, "burst.yml"));
    w.emit("change", path.join(dir, "burst.yml"));
    w.emit("change", path.join(dir, "burst.yml"));

    await fired;
    // Give any erroneous extra debounced fires a chance to land.
    await new Promise((r) => setTimeout(r, 200));
    expect(callCount).toBe(1);
  });
});
