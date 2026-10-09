import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createProbeLoader } from "./probe-loader.js";
import { createProbeRegistry } from "../drivers/index.js";
import { createDiscoveryRegistry } from "../discovery/index.js";
import { registerAllProbeDrivers } from "../../orchestrator.js";
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

  it("includeKind SKIPS (not rejects) a config whose kind the predicate excludes", async () => {
    // An HTTP family (smoke) + a browser family (e2e_smoke). The HTTP-only
    // caller registers ONLY the smoke driver and scopes the loader to exclude
    // browser kinds — the e2e_smoke YAML must be SKIPPED (loaded out), NOT
    // surfaced as a `probes.reload.failed` (it would otherwise fail the
    // no-driver-registered check against the HTTP-only registry).
    await fs.writeFile(
      path.join(dir, "smoke.yml"),
      [
        "kind: smoke",
        "id: smoke-http",
        'schedule: "*/5 * * * *"',
        "targets: [{ key: 'smoke:http', url: 'https://x.example' }]",
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(
      path.join(dir, "e2e-smoke.yml"),
      [
        "kind: e2e_smoke",
        "id: e2e-smoke-browser",
        'schedule: "*/5 * * * *"',
        "target: { key: 'e2e_smoke:browser', url: 'https://x.example' }",
      ].join("\n"),
      "utf-8",
    );
    const probeRegistry = createProbeRegistry();
    probeRegistry.register(mkDriver("smoke"));
    // NOTE: deliberately do NOT register an e2e_smoke driver — proving the
    // skip happens BEFORE the driver-resolution check.
    const bus = mkBus();
    const loader = createProbeLoader(dir, {
      probeRegistry,
      discoveryRegistry: createDiscoveryRegistry(),
      bus,
      logger,
      includeKind: (kind) => kind !== "e2e_smoke",
    });
    const configs = await loader.load();
    expect(configs.map((c) => c.id)).toEqual(["smoke-http"]);
    // Skipping must NOT produce a reload-failed event.
    expect(bus.events.some((e) => e.event === "probes.reload.failed")).toBe(
      false,
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

/**
 * Shipped-config integration guard.
 *
 * The hardcoded-set guard in orchestrator.test.ts only asserts that
 * `registerAllProbeDrivers` populates an EXPECTED list of kinds — it does
 * NOT read the on-disk YAMLs, so an orphaned config whose `kind` has no
 * registered driver (e.g. `e2e-parity.yml` after commit 7ac3e59a5 replaced
 * the `e2e_parity` driver registration with `e2e_d6`) sails past it while
 * the loader silently rejects that file at boot and drops its probe family
 * from the scheduler.
 *
 * This test closes that gap: it loads the REAL shipped `config/probes`
 * directory against the REAL driver registry (`registerAllProbeDrivers`)
 * and the REAL discovery sources, and asserts EVERY shipped YAML loads
 * clean — no `probes.reload.failed` errors, and the loaded config count
 * equals the shipped YAML count. Before the fix this fails on
 * `e2e-parity.yml` with `no driver registered for kind 'e2e_parity'`.
 */
describe("createProbeLoader against the real shipped config set", () => {
  // probes/loader/ -> ../../../config/probes (showcase/harness/config/probes)
  const shippedConfigDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../config/probes",
  );

  it("loads every shipped config/probes/*.yml with a registered driver and discovery source", async () => {
    const probeRegistry = createProbeRegistry();
    // No browser pool: the no-pool branch still registers the e2e_d6 driver
    // (the D6 all-pills kind that superseded e2e_parity), which is all the
    // shipped YAML's kinds need to resolve.
    registerAllProbeDrivers(probeRegistry);

    const discoveryRegistry = createDiscoveryRegistry();
    // The loader only checks that the source NAME is registered at load time
    // (it does not enumerate), so stub sources matching the real names are
    // sufficient to exercise the load-time invariant without Railway/pnpm.
    discoveryRegistry.register(mkSource("railway-services"));
    discoveryRegistry.register(mkSource("cross-env-pin-drift"));
    discoveryRegistry.register(mkSource("pnpm-packages"));

    const bus = mkBus();
    const loader = createProbeLoader(shippedConfigDir, {
      probeRegistry,
      discoveryRegistry,
      bus,
      logger,
    });

    const configs = await loader.load();

    // No file may have been rejected at load time. A rejection surfaces as a
    // `probes.reload.failed` bus event carrying the per-file errors — assert
    // none fired, and render the offenders if they did so a regression names
    // the exact file + reason.
    const failures = bus.events.filter(
      (e) => e.event === "probes.reload.failed",
    );
    expect(
      failures,
      `probe-loader rejected shipped config(s): ${JSON.stringify(failures.map((f) => f.payload))}`,
    ).toEqual([]);

    // Every shipped YAML must have produced a ProbeConfig (defends against a
    // silently-dropped file where the error list is empty but the count is
    // short — e.g. a future loader change that skips instead of erroring).
    const shippedYamls = (await fs.readdir(shippedConfigDir)).filter(
      (f) =>
        (f.endsWith(".yml") || f.endsWith(".yaml")) &&
        f !== "_defaults.yml" &&
        f !== "_defaults.yaml",
    );
    expect(configs.length).toBe(shippedYamls.length);
  });
});
