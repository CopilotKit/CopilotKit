import { describe, it, expect } from "vitest";
import { buildWorkerHealthServer } from "./worker-health.js";
import { logger } from "../../logger.js";

interface HealthBody {
  status: string;
  role: string;
  pb: string;
  loop: string;
  registered: boolean;
}

function build(opts: {
  pb?: boolean;
  loopAlive?: boolean;
  registered?: boolean;
}) {
  return buildWorkerHealthServer({
    pb: async () => opts.pb ?? true,
    loopAlive: () => opts.loopAlive ?? true,
    registered: () => opts.registered ?? true,
    logger,
  });
}

describe("fleet worker /health", () => {
  it("returns 200 when pb reachable, loop alive, and registered", async () => {
    const app = build({ pb: true, loopAlive: true, registered: true });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthBody;
    expect(body.status).toBe("ok");
    expect(body.role).toBe("worker");
    expect(body.pb).toBe("ok");
    expect(body.loop).toBe("alive");
    expect(body.registered).toBe(true);
  });

  it("returns 503 degraded when PocketBase is unreachable", async () => {
    const app = build({ pb: false });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as HealthBody;
    expect(body.status).toBe("degraded");
    expect(body.pb).toBe("down");
  });

  it("returns 503 degraded when the pull-loop has stopped", async () => {
    const app = build({ loopAlive: false });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as HealthBody;
    expect(body.status).toBe("degraded");
    expect(body.loop).toBe("stopped");
  });

  it("returns 503 degraded when the worker never registered", async () => {
    const app = build({ registered: false });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as HealthBody;
    expect(body.status).toBe("degraded");
    expect(body.registered).toBe(false);
  });

  it("returns 503 degraded (not a thrown 500) when the pb probe REJECTS", async () => {
    const app = buildWorkerHealthServer({
      pb: async () => {
        throw new Error("pb connect refused");
      },
      loopAlive: () => true,
      registered: () => true,
      logger,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as HealthBody;
    expect(body.status).toBe("degraded");
    expect(body.pb).toBe("down");
  });
});
