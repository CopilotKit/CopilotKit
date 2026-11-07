import { describe, expect, it, vi } from "vitest";
import { joinAimockJournal } from "./d6-all-pills.js";
import type { Logger, ProbeContext } from "../../types/index.js";

// The showcase aimock enforces inbound auth (AIMOCK_API_KEYS) on every route
// except GET /health, /ready and /metrics, so the post-run journal join must
// present the aimock client credential, and a rejected credential must be
// loud instead of a quiet diagnostic.

const RUN_ID = "run-123";
const SLUG = "langgraph-python";
const CLIENT_CREDENTIAL = "test-aimock-client-credential";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } satisfies Logger;
}

function makeCtx(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
  logger: Logger,
): ProbeContext {
  return { now: () => new Date(0), logger, env, fetchImpl };
}

function journalEntry() {
  return {
    method: "POST",
    path: "/v1/chat/completions",
    headers: { "x-diag-run-id": RUN_ID, "x-aimock-context": SLUG },
    status: 200,
  };
}

async function join(ctx: ProbeContext): Promise<void> {
  await joinAimockJournal({
    ctx,
    aimockBaseUrl: "http://showcase-aimock.railway.internal:4010",
    runId: RUN_ID,
    slug: SLUG,
    featureType: "agentic-chat",
    rowPrefix: "d6",
    cvComponent: "harness-d6",
    testId: "d6-test",
    featureOk: true,
  });
}

describe("joinAimockJournal inbound auth", () => {
  it("sends AIMOCK_API_KEY as a Bearer credential on the journal read", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json([journalEntry()]),
    );
    const logger = makeLogger();

    await join(
      makeCtx({ AIMOCK_API_KEY: CLIENT_CREDENTIAL }, fetchImpl, logger),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(
      "http://showcase-aimock.railway.internal:4010/__aimock/journal",
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${CLIENT_CREDENTIAL}`);
    expect(headers.get("accept")).toBe("application/json");
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("status=ok"),
    );
  });

  it("sends no credential header when AIMOCK_API_KEY is unset (local aimock)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json([journalEntry()]),
    );

    await join(makeCtx({}, fetchImpl, makeLogger()));

    const headers = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(headers.has("authorization")).toBe(false);
  });

  it("logs a rejected journal credential at error level, naming the cause", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 401 }),
    );
    const logger = makeLogger();

    await join(makeCtx({}, fetchImpl, logger));

    expect(logger.error).toHaveBeenCalledTimes(1);
    const line = String(logger.error.mock.calls[0][0]);
    expect(line).toContain("journal fetch 401");
    expect(line).toContain("AIMOCK_API_KEY unset");
  });

  it("does not throw into the probe when the journal read is rejected", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 403 }),
    );
    const logger = makeLogger();

    await expect(
      join(makeCtx({ AIMOCK_API_KEY: CLIENT_CREDENTIAL }, fetchImpl, logger)),
    ).resolves.toBeUndefined();
    expect(String(logger.error.mock.calls[0][0])).toContain(
      "AIMOCK_API_KEY rejected",
    );
  });
});
