import { describe, it, expect } from "vitest";
import {
  createJobClaimClient,
  JobClaimEndpointError,
  type JobView,
} from "./job-claim.js";
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

  it("a 401 retry does NOT clobber a token a concurrent caller already refreshed (G1g)", async () => {
    // RACE: caller A's request goes out under tok1 and 401s; while that
    // response is in flight, caller B also 401s, re-auths, and installs
    // tok2. A's 401 handling then blindly nulled authToken — discarding the
    // FRESH tok2 and forcing a third auth round-trip (and under sustained
    // concurrency, an auth stampede). A must only invalidate the token if it
    // is STILL the one its failed request used.
    let authCalls = 0;
    let releaseJ1: ((r: Response) => void) | undefined;
    const j1Gate = new Promise<Response>((res) => {
      releaseJ1 = res;
    });
    let j1Calls = 0;
    let j2Calls = 0;
    const claimAuthHeaders: string[] = [];
    const fetchImpl = makeFetch(async (url, init) => {
      if (url.includes("auth-with-password")) {
        authCalls += 1;
        return new Response(JSON.stringify({ token: `tok${authCalls}` }), {
          status: 200,
        });
      }
      const body = JSON.parse(String(init?.body)) as { jobId: string };
      claimAuthHeaders.push(
        String((init?.headers as Record<string, string>).authorization),
      );
      if (body.jobId === "j1") {
        j1Calls += 1;
        // A's FIRST request hangs until the test releases it (after B's
        // refresh has completed); its retry succeeds.
        if (j1Calls === 1) return j1Gate;
        return new Response(
          JSON.stringify({ claimed: true, job: SAMPLE_JOB }),
          { status: 200 },
        );
      }
      j2Calls += 1;
      if (j2Calls === 1) return new Response("unauthorized", { status: 401 });
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

    // A: auth (tok1) → POST j1 (hangs on the gate).
    const pA = client.claimJob("j1", "wA", 30);
    await new Promise((r) => setTimeout(r, 10));
    // B: 401 under tok1 → re-auth (tok2) → retry wins.
    const rB = await client.claimJob("j2", "wB", 30);
    expect(rB.won).toBe(true);
    // Now A's first request comes back 401 — but tok2 is already installed.
    releaseJ1!(new Response("unauthorized", { status: 401 }));
    const rA = await pA;
    expect(rA.won).toBe(true);

    // Exactly TWO auths total: the initial one and B's refresh. A's retry
    // reused B's fresh tok2 instead of nulling it and re-authing a third
    // time.
    expect(authCalls).toBe(2);
    expect(claimAuthHeaders[claimAuthHeaders.length - 1]).toBe("tok2");
  });

  it("throws a descriptive error on a non-401 failure status (renew/release)", async () => {
    const fetchImpl = authedFetch(() => new Response("boom", { status: 500 }));
    const client = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    await expect(client.renewLease("j1", "worker-7", 30)).rejects.toThrow(
      /\/api\/fleet\/renew failed: 500/,
    );
    await expect(client.releaseJob("j1", "worker-7", "done")).rejects.toThrow(
      /\/api\/fleet\/release failed: 500/,
    );
  });

  it("threads the HTTP status onto thrown endpoint errors (JobClaimEndpointError)", async () => {
    // The sweep's thrown-release handling discriminates DETERMINISTIC 4xx
    // refusals (the hook rejected the request — nothing committed) from
    // indeterminate 5xx/transport throws (may have committed). That
    // discrimination needs the status ON the error, not in its message.
    const fetchImpl = authedFetch(
      () => new Response("bad body", { status: 400 }),
    );
    const client = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    let thrown: unknown;
    try {
      await client.releaseJob("j1", "", "pending");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(JobClaimEndpointError);
    expect((thrown as JobClaimEndpointError).status).toBe(400);
    expect((thrown as JobClaimEndpointError).path).toBe("/api/fleet/release");
  });

  it("claimJob maps a 5xx to a LOST CAS (won: false) instead of throwing", async () => {
    // A WAL serialization/busy error escaping runInTransaction surfaces as a
    // 500 — indistinguishable from losing the race (the row either was or
    // will be won by a peer). Throwing aborted the caller's whole candidate
    // rotation; mapping to won:false lets claimNext fall through to the next
    // candidate. (4xx — caller bugs — still throw loud below.)
    const fetchImpl = authedFetch(
      () => new Response("wal busy", { status: 500 }),
    );
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

  it("claimJob still throws on a 4xx (caller bug, fail loud)", async () => {
    const fetchImpl = authedFetch(
      () => new Response("bad body", { status: 400 }),
    );
    const client = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    await expect(client.claimJob("j1", "worker-7", 30)).rejects.toThrow(
      /\/api\/fleet\/claim failed: 400/,
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

  describe("2xx indeterminate body (G1a) — a committed CAS must never fabricate a loss", () => {
    // A 2xx means the endpoint COMMITTED the transition server-side. If the
    // body is then unreadable/empty/unparseable, the OUTCOME is unknown —
    // the old empty→`{}` mapping fabricated a CAS LOSS for an operation
    // that may have WON: a won claim was abandoned (stranded claimed row),
    // a successful renew killed the heartbeat (the false
    // worker-crashed-mid-job class), a committed release reported the
    // result discarded. Indeterminate must THROW with context; callers
    // contain the throw (claimNext per-candidate, renewLease assumed-live,
    // sweep conservative, report retry).
    function client(fetchImpl: typeof fetch) {
      return createJobClaimClient({
        url: "http://pb",
        email: "a@b",
        password: "pw",
        logger,
        fetchImpl,
      });
    }

    it("claimJob THROWS on a 2xx with an EMPTY body (not won:false)", async () => {
      const c = client(authedFetch(() => new Response("", { status: 200 })));
      await expect(c.claimJob("j1", "worker-7", 30)).rejects.toThrow(
        /job-claim \/api\/fleet\/claim: 2xx body unreadable — outcome indeterminate/,
      );
    });

    it("renewLease THROWS on a 2xx with an EMPTY body (not renewed:false — no false worker-crashed)", async () => {
      const c = client(authedFetch(() => new Response("", { status: 200 })));
      await expect(c.renewLease("j1", "worker-7", 30)).rejects.toThrow(
        /job-claim \/api\/fleet\/renew: 2xx body unreadable — outcome indeterminate/,
      );
    });

    it("releaseJob THROWS on a 2xx with an EMPTY body (not released:false)", async () => {
      const c = client(authedFetch(() => new Response("", { status: 200 })));
      await expect(c.releaseJob("j1", "worker-7", "done")).rejects.toThrow(
        /job-claim \/api\/fleet\/release: 2xx body unreadable — outcome indeterminate/,
      );
    });

    it("THROWS on a 2xx whose body is unparseable JSON", async () => {
      const c = client(
        authedFetch(() => new Response("<html>proxy", { status: 200 })),
      );
      await expect(c.claimJob("j1", "worker-7", 30)).rejects.toThrow(
        /2xx body unreadable — outcome indeterminate.*unparseable/,
      );
    });

    it("THROWS on a 2xx whose body READ rejects (socket reset mid-body)", async () => {
      const c = client(
        authedFetch(
          () =>
            ({
              ok: true,
              status: 200,
              text: () => Promise.reject(new Error("socket reset mid-body")),
            }) as unknown as Response,
        ),
      );
      await expect(c.renewLease("j1", "worker-7", 30)).rejects.toThrow(
        /2xx body unreadable — outcome indeterminate.*socket reset mid-body/,
      );
    });
  });

  it("memoizes the in-flight auth promise — a concurrent stampede authenticates ONCE", async () => {
    let authCalls = 0;
    const fetchImpl = makeFetch(async (url) => {
      if (url.includes("auth-with-password")) {
        authCalls += 1;
        // Slow auth so the concurrent callers all arrive while it's in flight.
        await new Promise((r) => setTimeout(r, 20));
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
    await Promise.all([
      client.claimJob("j1", "w1", 30),
      client.claimJob("j2", "w2", 30),
      client.claimJob("j3", "w3", 30),
    ]);
    expect(authCalls).toBe(1);
  });

  it("wraps an unparseable auth body with context instead of a bare SyntaxError", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.includes("auth-with-password")) {
        return new Response("<html>proxy intercept</html>", { status: 200 });
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
      /job-claim auth: unparseable response body \(status 200\)/,
    );
  });

  it("treats a claimed:true response carrying an alreadyHeld marker as a plain win (no-op extra field)", async () => {
    // The hook's claim idempotency for timeout-after-commit returns
    // { claimed: true, alreadyHeld: true, job } when the SAME worker
    // re-claims a row it already holds with a live lease. The client treats
    // it as a win; the marker is informational.
    const fetchImpl = authedFetch(
      () =>
        new Response(
          JSON.stringify({ claimed: true, alreadyHeld: true, job: SAMPLE_JOB }),
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
    const r = await client.claimJob("j1", "worker-7", 30);
    expect(r.won).toBe(true);
    expect(r.job?.id).toBe("j1");
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
