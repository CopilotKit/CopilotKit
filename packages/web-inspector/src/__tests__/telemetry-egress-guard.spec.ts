import { describe, expect, it, vi } from "vitest";

import { createTelemetryEgressGuard } from "../lib/testing/telemetry-egress-guard.js";

// The inspector's telemetry is browser-side and fire-and-forget, and jsdom has a
// real `fetch`. The setup-file guard is what keeps unit runs — local and CI —
// from POSTing real `oss.inspector.*` events to the live sink.

describe("telemetry egress guard", () => {
  it("swallows requests to the telemetry sink without touching the network", async () => {
    const realFetch = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    ) as unknown as typeof fetch;

    const guarded = createTelemetryEgressGuard(realFetch);
    const response = await guarded("https://telemetry.copilotkit.ai/ingest", {
      method: "POST",
      body: "{}",
    });

    expect(response.status).toBe(204);
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("passes every other request through untouched", async () => {
    const realFetch = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    ) as unknown as typeof fetch;

    const guarded = createTelemetryEgressGuard(realFetch);
    await guarded("https://cdn.copilotkit.ai/announcements.json");
    await guarded(new URL("http://localhost/api/threads"));

    expect(realFetch).toHaveBeenCalledTimes(2);
  });

  it("is installed on the global fetch for every test in this package", () => {
    // A raw platform fetch would stringify as native code; the guard doesn't.
    expect(String(globalThis.fetch)).not.toContain("[native code]");
  });
});
