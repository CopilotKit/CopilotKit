/**
 * Showcase render fns: each posts a card + chart image(s), uses live data when
 * the API responds, and falls back to sample data (never throws) when it
 * doesn't. We drive each `render*` fn with a fake `thread` recording `post`
 * calls, and stub `fetch`/env to exercise both the live and fallback paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderPrRadar } from "../pr-radar.js";
import { renderWeeklyPulse } from "../weekly-pulse.js";
import { renderStandup } from "../cycle-standup.js";

function fakeThread() {
  const post = vi.fn(async (_ui: unknown, _opts?: unknown) => ({ id: "F1" }));
  return { post, thread: { post } as never };
}

function res(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "err",
    json: async () => body,
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("PR radar", () => {
  it("live: posts the card + age chart from GitHub data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        res([
          {
            number: 1,
            title: "a",
            draft: false,
            created_at: new Date().toISOString(),
            user: { login: "x" },
          },
          {
            number: 2,
            title: "b",
            draft: true,
            created_at: new Date().toISOString(),
            user: { login: "y" },
          },
        ]),
      ),
    );
    const { post, thread } = fakeThread();
    const msg = await renderPrRadar(thread);
    expect(post).toHaveBeenCalledTimes(2); // card + chart (1 non-draft PR)
    expect(post.mock.calls[0]![1]).toMatchObject({ filename: "pr-radar.png" });
    expect(post.mock.calls[1]![1]).toMatchObject({ filename: "pr-age.png" });
    expect(msg).toMatch(/open PR/);
  });

  it("fallback: uses sample data when GitHub fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res(null, false)),
    );
    const { post, thread } = fakeThread();
    const msg = await renderPrRadar(thread);
    expect(post).toHaveBeenCalledTimes(2); // sample has PRs → chart posts too
    expect(msg).toMatch(/sample data/);
  });
});

describe("weekly pulse", () => {
  it("live: posts KPI card + downloads + issues charts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("npmjs.org"))
          return res({ downloads: [{ downloads: 10, day: "2026-07-20" }] });
        if (url.includes("/search/issues")) return res({ total_count: 5 });
        return res({ stargazers_count: 100, open_issues_count: 7 });
      }),
    );
    const { post, thread } = fakeThread();
    const msg = await renderWeeklyPulse(thread);
    expect(post).toHaveBeenCalledTimes(3);
    expect(
      post.mock.calls.map((c) => (c[1] as { filename: string }).filename),
    ).toEqual(["pulse.png", "downloads.png", "issues.png"]);
    expect(msg).toMatch(/downloads/);
  });

  it("fallback: uses sample data when a fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res(null, false)),
    );
    const { post, thread } = fakeThread();
    const msg = await renderWeeklyPulse(thread);
    expect(post).toHaveBeenCalledTimes(3);
    expect(msg).toMatch(/sample data/);
  });
});

describe("cycle standup", () => {
  const KEY = "LINEAR_API_KEY";
  beforeEach(() => delete process.env[KEY]);
  afterEach(() => delete process.env[KEY]);

  it("fallback: no LINEAR_API_KEY → sample data", async () => {
    const { post, thread } = fakeThread();
    const msg = await renderStandup(thread);
    expect(post).toHaveBeenCalledTimes(3); // card + status pie + assignee bar
    expect(msg).toMatch(/sample data/);
  });

  it("live: posts card + status + load from Linear data", async () => {
    process.env[KEY] = "lin_test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        res({
          data: {
            teams: {
              nodes: [
                {
                  name: "CPK",
                  activeCycle: {
                    name: "Cycle 1",
                    number: 1,
                    startsAt: "2026-07-20T00:00:00Z",
                    endsAt: "2026-08-01T00:00:00Z",
                    issues: {
                      nodes: [
                        {
                          state: { name: "Done", type: "completed" },
                          assignee: { displayName: "a" },
                        },
                        {
                          state: { name: "In Progress", type: "started" },
                          assignee: { displayName: "b" },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        }),
      ),
    );
    const { post, thread } = fakeThread();
    const msg = await renderStandup(thread);
    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls[0]![1]).toMatchObject({ filename: "standup.png" });
    expect(msg).toMatch(/done/);
  });
});
