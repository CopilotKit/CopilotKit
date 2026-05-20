import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createProbeLoader } from "./probe-loader.js";
import { createProbeRegistry } from "../drivers/index.js";
import { createDiscoveryRegistry } from "../discovery/index.js";
import { z } from "zod";
import type { DiscoverySource, ProbeDriver } from "../types.js";
import { logger } from "../../logger.js";

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
    const probeRegistry = createProbeRegistry();
    probeRegistry.register(mkDriver("smoke"));
    const bus = mkBus();
    const loader = createProbeLoader(dir, {
      probeRegistry,
      discoveryRegistry: createDiscoveryRegistry(),
      bus,
      logger,
      // Force polling for this test only. chokidar's native FSEvents
      // backend on macOS (and inotify under some Linux configs) does not
      // reliably emit events for files written into a fresh mkdtemp dir
      // on Node 22+ — the parent path isn't pre-watched by the kernel, so
      // the event stream silently drops the first add. Polling is the
      // documented chokidar workaround and is what the upstream test
      // suite uses for the same reason.
      watcherOptionsOverride: { usePolling: true, interval: 50 },
    });

    let lastConfigs: unknown[] = [];
    let callbackFired = 0;
    const unwatch = loader.watch((configs) => {
      lastConfigs = configs;
      callbackFired += 1;
    });

    // Give the polling watcher one tick to take its initial snapshot
    // before we write the new file — without this, the snapshot can race
    // with the write and miss the first add.
    await new Promise((r) => setTimeout(r, 200));

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

    // Poll for the watch callback to fire and reflect the new file.
    // Replaces a fixed setTimeout(500) which raced chokidar's debounce on
    // macOS APFS where mtime resolution + FSEvents latency can push the
    // first event past 500ms. waitFor keeps the assertion deterministic
    // without inflating the happy-path runtime.
    try {
      await vi.waitFor(
        () => {
          expect(callbackFired).toBeGreaterThan(0);
          expect(
            (lastConfigs as { id: string }[]).some((c) => c.id === "smoke-new"),
          ).toBe(true);
        },
        { timeout: 8_000, interval: 50 },
      );
    } finally {
      unwatch();
    }
  }, 15_000);
});
