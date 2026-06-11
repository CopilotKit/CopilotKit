import { describe, it, expect } from "vitest";
import { createJobClaimClient, type JobView } from "./job-claim.js";
import { logger } from "../logger.js";

function makeFetch(
  handler: (
    url: string,
    init: RequestInit | undefined,
  ) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    return handler(String(input), init);
  }) as unknown as typeof fetch;
}

const SAMPLE_JOB: JobView = {
  id: "j1",
  probe_key: "svc:liveness",
  status: "claimed",
  claimed_by: "worker-7",
  lease_expires_at: "2026-06-04T18:00:00.000Z",
  version: 1,
};

function authedFetch(
  routeHandler: (url: string, init: RequestInit | undefined) => Response,
): typeof fetch {
  return makeFetch((url, init) => {
    if (url.includes("auth-with-password")) {
      return new Response(JSON.stringify({ token: "tok", record: {} }), {
        status: 200,
      });
    }
    return routeHandler(url, init);
  });
}

describe("job-claim client", () => {
  it("authenticates as superuser before calling the claim endpoint", async () => {
    const calls: string[] = [];
    const fetchImpl = authedFetch((url) => {
      calls.push(url);
      return new Response(JSON.stringify({ claimed: true, job: SAMPLE_JOB }), {
        status: 200,
      });
    });
    const client = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    const r = await client.claimJob("j1", "worker-7", 30);
    expect(r.won).toBe(true);
    expect(r.job?.id).toBe("j1");
    expect(calls[0]).toContain("/api/fleet/claim");
  });

  it("falls back to /api/admins on a 404 from /_superusers", async () => {
    const authPaths: string[] = [];
    const fetchImpl = makeFetch((url) => {
      if (url.includes("/_superusers/auth-with-password")) {
        authPaths.push(url);
        return new Response("not found", { status: 404 });
      }
      if (url.includes("/api/admins/auth-with-password")) {
        authPaths.push(url);
        return new Response(JSON.stringify({ token: "tok" }), { status: 200 });
      }
      return new Response(JSON.stringify({ claimed: false }), { status: 200 });
    });
    const client = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    await client.claimJob("j1", "worker-7", 30);
    expect(authPaths.some((p) => p.includes("/api/admins"))).toBe(true);
  });

  it("reports won=false when the endpoint says the row was already taken", async () => {
    const fetchImpl = authedFetch(
      () => new Response(JSON.stringify({ claimed: false }), { status: 200 }),
    );
    const client = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    const r = await client.claimJob("j1", "loser", 30);
    expect(r.won).toBe(false);
    expect(r.job).toBeUndefined();
  });

  it("renewLease reports renewed and surfaces the updated job", async () => {
    const fetchImpl = authedFetch((url) => {
      expect(url).toContain("/api/fleet/renew");
      return new Response(
        JSON.stringify({
          renewed: true,
          job: { ...SAMPLE_JOB, status: "running", version: 2 },
        }),
        { status: 200 },
      );
    });
    const client = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    const r = await client.renewLease("j1", "worker-7", 30);
    expect(r.renewed).toBe(true);
    expect(r.job?.status).toBe("running");
    expect(r.job?.version).toBe(2);
  });

  it("renewLease reports renewed=false when the lease was lost", async () => {
    const fetchImpl = authedFetch(
      () => new Response(JSON.stringify({ renewed: false }), { status: 200 }),
    );
    const client = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    const r = await client.renewLease("j1", "worker-7", 30);
    expect(r.renewed).toBe(false);
  });

  it("releaseJob posts the target status and reports released", async () => {
    let sentBody: unknown;
    const fetchImpl = authedFetch((url, init) => {
      expect(url).toContain("/api/fleet/release");
      sentBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          released: true,
          job: { ...SAMPLE_JOB, status: "done" },
        }),
        { status: 200 },
      );
    });
    const client = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    const r = await client.releaseJob("j1", "worker-7", "done");
    expect(r.released).toBe(true);
    expect(r.job?.status).toBe("done");
    expect(sentBody).toMatchObject({
      jobId: "j1",
      workerId: "worker-7",
      status: "done",
    });
  });

  it("releaseJob threads the hook's refusal reason on released:false", async () => {
    // report()'s retry truthfulness depends on this field reaching the
    // caller: refused_terminal_same_holder means the caller's own earlier
    // release committed (timeout-after-commit) and its result write is still
    // authorized.
    const fetchImpl = authedFetch(
      () =>
        new Response(
          JSON.stringify({
            released: false,
            reason: "refused_terminal_same_holder",
          }),
          { status: 200 },
        ),
    );
    const client = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    const r = await client.releaseJob("j1", "worker-7", "done");
    expect(r.released).toBe(false);
    expect(r.reason).toBe("refused_terminal_same_holder");
  });

  it("releaseJob omits reason when the endpoint sends none (legacy body shape)", async () => {
    const fetchImpl = authedFetch(
      () => new Response(JSON.stringify({ released: false }), { status: 200 }),
    );
    const client = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    const r = await client.releaseJob("j1", "worker-7", "done");
    expect(r.released).toBe(false);
    expect(r.reason).toBeUndefined();
  });

  it("re-authenticates once on a 401 then retries the request", async () => {
    let claimCalls = 0;
    let authCalls = 0;
    const fetchImpl = makeFetch((url) => {
      if (url.includes("auth-with-password")) {
        authCalls += 1;
        return new Response(JSON.stringify({ token: `tok${authCalls}` }), {
          status: 200,
        });
      }
      claimCalls += 1;
      if (claimCalls === 1)
        return new Response("unauthorized", { status: 401 });
      return new Response(JSON.stringify({ claimed: true, job: SAMPLE_JOB }), {
        status: 200,
      });
    });
    const client = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    const r = await client.claimJob("j1", "worker-7", 30);
    expect(r.won).toBe(true);
    expect(authCalls).toBe(2);
    expect(claimCalls).toBe(2);
  });

  it("throws a descriptive error on a non-401 failure status", async () => {
    const fetchImpl = authedFetch(() => new Response("boom", { status: 500 }));
    const client = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    await expect(client.claimJob("j1", "worker-7", 30)).rejects.toThrow(
      /\/api\/fleet\/claim failed: 500/,
    );
  });

  it("throws when superuser credentials are not configured", async () => {
    const fetchImpl = makeFetch(() => new Response("{}", { status: 200 }));
    const client = createJobClaimClient({
      url: "http://pb",
      logger,
      fetchImpl,
    });
    await expect(client.claimJob("j1", "worker-7", 30)).rejects.toThrow(
      /POCKETBASE_SUPERUSER_EMAIL\/PASSWORD not set/,
    );
  });

  it("throws when the auth endpoint returns an empty token", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.includes("auth-with-password")) {
        return new Response(JSON.stringify({ token: "" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    const client = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    await expect(client.claimJob("j1", "worker-7", 30)).rejects.toThrow(
      /empty or non-string token/,
    );
  });

  it("treats an empty auth body as a missing token and throws", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.includes("auth-with-password")) {
        // 200 with an empty body — observed on PB restarts.
        return new Response("", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    const client = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    await expect(client.claimJob("j1", "worker-7", 30)).rejects.toThrow(
      /empty or non-string token/,
    );
  });

  it("treats an empty endpoint body as a non-win without throwing", async () => {
    const fetchImpl = authedFetch(() => new Response("", { status: 200 }));
    const client = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    const r = await client.claimJob("j1", "worker-7", 30);
    expect(r.won).toBe(false);
    expect(r.job).toBeUndefined();
  });

  it("throws when the auth endpoint itself fails", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.includes("auth-with-password")) {
        return new Response("bad creds", { status: 400 });
      }
      return new Response("{}", { status: 200 });
    });
    const client = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    await expect(client.claimJob("j1", "worker-7", 30)).rejects.toThrow(
      /auth failed: 400/,
    );
  });
});
