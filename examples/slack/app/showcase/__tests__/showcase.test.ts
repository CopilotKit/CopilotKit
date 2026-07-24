/**
 * Showcase render fns: each leads with a text summary, then posts a card +
 * chart image(s); uses live data when the API responds and falls back to sample
 * data (never throws) when it doesn't. We drive each `render*` fn with a fake
 * `thread` recording `post` calls, and stub `fetch`/env for both paths.
 *
 * The leading text post is load-bearing: it's the only Slack *text* an
 * image-post turn produces, so it survives history reconstruction (see the
 * render fns) — hence each feature's post count is `1 (text) + images`.
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

/** filenames of the image posts (post calls that carry an opts.filename). */
function filenames(post: ReturnType<typeof fakeThread>["post"]): string[] {
  return post.mock.calls
    .map((c) => (c[1] as { filename?: string } | undefined)?.filename)
    .filter((f): f is string => Boolean(f));
}

afterEach(() => vi.unstubAllGlobals());

describe("PR radar", () => {
  it("live: leads with text, then posts the card + age chart", async () => {
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
    expect(post).toHaveBeenCalledTimes(3); // text + card + chart (1 non-draft PR)
    expect(typeof post.mock.calls[0]![0]).toBe("string");
    expect(filenames(post)).toEqual(["pr-radar.png", "pr-age.png"]);
    expect(msg).toMatch(/open PR/);
  });

  it("fallback: uses sample data when GitHub fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res(null, false)),
    );
    const { post, thread } = fakeThread();
    const msg = await renderPrRadar(thread);
    expect(post).toHaveBeenCalledTimes(3); // text + card + chart (sample has PRs)
    expect(post.mock.calls[0]![0]).toMatch(/sample data/);
    expect(msg).toMatch(/sample data/);
  });
});

describe("weekly pulse", () => {
  it("live: leads with text, then KPI card + downloads + issues charts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("npmjs.org"))
          return res({ downloads: [{ downloads: 10, day: "2026-07-20" }] });
        if (url.includes("/search/issues")) return res({ total_count: 5 });
        return res({ stargazers_count: 100 });
      }),
    );
    const { post, thread } = fakeThread();
    const msg = await renderWeeklyPulse(thread);
    expect(post).toHaveBeenCalledTimes(4); // text + card + line + bar
    expect(filenames(post)).toEqual([
      "pulse.png",
      "downloads.png",
      "issues.png",
    ]);
    expect(msg).toMatch(/downloads/);
  });

  it("fallback: uses sample data when a fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res(null, false)),
    );
    const { post, thread } = fakeThread();
    const msg = await renderWeeklyPulse(thread);
    expect(post).toHaveBeenCalledTimes(4);
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
    expect(post).toHaveBeenCalledTimes(3); // text + card + stacked bar
    expect(post.mock.calls[0]![0]).toMatch(/sample data/);
    expect(msg).toMatch(/sample data/);
  });

  it("live: posts per-team progress from Linear data", async () => {
    process.env[KEY] = "lin_test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        res({
          data: {
            teams: {
              nodes: [
                {
                  name: "OSS",
                  activeCycle: {
                    name: "Cycle 1",
                    number: 1,
                    issues: {
                      nodes: [
                        { state: { type: "completed" } },
                        { state: { type: "started" } },
                        { state: { type: "unstarted" } },
                      ],
                    },
                  },
                },
                { name: "NoCycle", activeCycle: null },
              ],
            },
          },
        }),
      ),
    );
    const { post, thread } = fakeThread();
    const msg = await renderStandup(thread);
    expect(post).toHaveBeenCalledTimes(3);
    expect(filenames(post)).toEqual(["standup.png", "cycle-load.png"]);
    expect(msg).toMatch(/done across 1 team/); // NoCycle filtered out
  });
});
