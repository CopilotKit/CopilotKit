import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GitHubAppTokenProvider, StaticTokenProvider } from "./app-auth.js";
import { withBotMarker } from "./bot-marker.js";
import { GitHubApiClient, GitHubApiError } from "./client.js";
import type { GitHubTokenProvider } from "./app-auth.js";
import type { GitHubComment, ReplyTarget } from "./types.js";

const API = "https://api.github.test";
const REPO = `${API}/repos/acme/widgets`;
const TARGET: ReplyTarget = { owner: "acme", repo: "widgets", issueNumber: 7 };

interface RecordedRequest {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
}

type Responder = (request: RecordedRequest) => Response;

function createComment(overrides: Partial<GitHubComment> = {}): GitHubComment {
  return {
    id: 1,
    body: "hello",
    user: { login: "octocat", id: 10, type: "User" },
    html_url: "https://github.test/acme/widgets/issues/7#issuecomment-1",
    created_at: "2026-11-10T10:00:00Z",
    ...overrides,
  };
}

/** A client over a fake fetch that records every request and answers with `respond`. */
function createClient(
  respond: Responder = () => Response.json(createComment()),
  options: { auth?: GitHubTokenProvider; now?: () => number } = {},
) {
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = {
      method: init?.method ?? "GET",
      url: String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    return respond(request);
  };
  const client = new GitHubApiClient({
    auth: options.auth ?? new StaticTokenProvider("ghp_test"),
    apiBaseUrl: API,
    fetch: fetchImpl,
    now: options.now,
  });
  return { client, requests };
}

function only(requests: RecordedRequest[]) {
  expect(requests).toHaveLength(1);
  const [request] = requests;
  if (request === undefined) throw new Error("no request recorded");
  return { method: request.method, url: request.url, body: request.body };
}

describe("GitHubApiClient requests", () => {
  it("createIssueComment POSTs the body with GitHub headers and returns the comment", async () => {
    const created = createComment({ id: 99, body: "hi there" });
    const { client, requests } = createClient(() =>
      Response.json(created, { status: 201 }),
    );

    const comment = await client.createIssueComment(TARGET, "hi there");

    expect(comment).toEqual(created);
    expect(only(requests)).toEqual({
      method: "POST",
      url: `${REPO}/issues/7/comments`,
      body: { body: withBotMarker("hi there") },
    });
    const headers = requests[0]!.headers;
    const sentHeaders = [
      "accept",
      "x-github-api-version",
      "authorization",
      "user-agent",
      "content-type",
    ].map((name) => [name, headers.get(name)]);
    expect(sentHeaders).toEqual([
      ["accept", "application/vnd.github+json"],
      ["x-github-api-version", "2022-11-28"],
      ["authorization", "Bearer ghp_test"],
      ["user-agent", "copilotkit-channels-github"],
      ["content-type", "application/json"],
    ]);
  });

  it.each([
    {
      name: "updateIssueComment",
      call: (c: GitHubApiClient) => c.updateIssueComment(TARGET, 5, "edited"),
      expected: {
        method: "PATCH",
        url: `${REPO}/issues/comments/5`,
        body: { body: withBotMarker("edited") },
      },
    },
    {
      name: "getIssue",
      call: (c: GitHubApiClient) => c.getIssue(TARGET),
      expected: {
        method: "GET",
        url: `${REPO}/issues/7`,
        body: undefined,
      },
    },
    {
      name: "deleteIssueComment",
      call: (c: GitHubApiClient) => c.deleteIssueComment(TARGET, 5),
      expected: {
        method: "DELETE",
        url: `${REPO}/issues/comments/5`,
        body: undefined,
      },
    },
    {
      name: "replyToReviewComment",
      call: (c: GitHubApiClient) => c.replyToReviewComment(TARGET, 3, "reply"),
      expected: {
        method: "POST",
        url: `${REPO}/pulls/7/comments/3/replies`,
        body: { body: withBotMarker("reply") },
      },
    },
    {
      name: "updateReviewComment",
      call: (c: GitHubApiClient) => c.updateReviewComment(TARGET, 4, "edited"),
      expected: {
        method: "PATCH",
        url: `${REPO}/pulls/comments/4`,
        body: { body: withBotMarker("edited") },
      },
    },
    {
      name: "deleteReviewComment",
      call: (c: GitHubApiClient) => c.deleteReviewComment(TARGET, 4),
      expected: {
        method: "DELETE",
        url: `${REPO}/pulls/comments/4`,
        body: undefined,
      },
    },
  ])(
    "$name sends $expected.method $expected.url",
    async ({ call, expected }) => {
      const { client, requests } = createClient(() =>
        expected.method === "DELETE"
          ? new Response(null, { status: 204 })
          : Response.json(createComment()),
      );

      await call(client);

      expect(only(requests)).toEqual(expected);
    },
  );

  it("URL-encodes owner and repo", async () => {
    const { client, requests } = createClient();

    await client.createIssueComment(
      { owner: "a b", repo: "c/d", issueNumber: 1 },
      "x",
    );

    expect(requests[0]?.url).toBe(`${API}/repos/a%20b/c%2Fd/issues/1/comments`);
  });

  it.each([
    {
      kind: "issue" as const,
      url: `${REPO}/issues/comments/8/reactions`,
    },
    {
      kind: "review" as const,
      url: `${REPO}/pulls/comments/8/reactions`,
    },
  ])(
    "adds and removes a reaction on a $kind comment",
    async ({ kind, url }) => {
      const { client, requests } = createClient(({ method }) =>
        method === "DELETE"
          ? new Response(null, { status: 204 })
          : Response.json({ id: 555, content: "eyes" }, { status: 201 }),
      );
      const ref = { kind, commentId: 8 };

      const reactionId = await client.addReaction(TARGET, ref, "eyes");
      await client.removeReaction(TARGET, ref, reactionId);

      expect(reactionId).toBe(555);
      expect(
        requests.map(({ method, url, body }) => ({ method, url, body })),
      ).toEqual([
        { method: "POST", url, body: { content: "eyes" } },
        { method: "DELETE", url: `${url}/555`, body: undefined },
      ]);
    },
  );
});

describe("GitHubApiClient lists", () => {
  it("listIssueComments follows Link rel=next until the last page", async () => {
    const page2 = `${REPO}/issues/7/comments?per_page=100&page=2`;
    const page3 = `${REPO}/issues/7/comments?per_page=100&page=3`;
    const pages = new Map([
      [
        `${REPO}/issues/7/comments?per_page=100`,
        { ids: [1, 2], link: `<${page2}>; rel="next", <${page3}>; rel="last"` },
      ],
      [
        page2,
        { ids: [3], link: `<${page3}>; rel="next", <${page3}>; rel="last"` },
      ],
      [page3, { ids: [4], link: `<${page2}>; rel="prev"` }],
    ]);
    const { client, requests } = createClient(({ url }) => {
      const page = pages.get(url);
      if (page === undefined)
        return new Response("unexpected", { status: 500 });
      return Response.json(
        page.ids.map((id) => createComment({ id })),
        { headers: { link: page.link } },
      );
    });

    const comments = await client.listIssueComments(TARGET);

    expect(comments.map((c) => c.id)).toEqual([1, 2, 3, 4]);
    expect(requests).toHaveLength(3);
  });

  it("reads past 10 pages, so the newest comments are kept", async () => {
    const { client, requests } = createClient(({ url }) => {
      const page = (url.match(/&more/g) ?? []).length;
      const isLast = page === 11;
      return Response.json([createComment({ id: page })], {
        headers: isLast ? {} : { link: `<${url}&more>; rel="next"` },
      });
    });

    const comments = await client.listIssueComments(TARGET);

    expect(requests).toHaveLength(12);
    expect(comments.at(-1)?.id).toBe(11);
  });

  it("throws instead of returning a list without the newest comments past 100 pages", async () => {
    const { client, requests } = createClient(({ url }) =>
      Response.json([createComment()], {
        headers: { link: `<${url}&more>; rel="next"` },
      }),
    );

    await expect(client.listIssueComments(TARGET)).rejects.toThrow(
      "has more than 10000 items",
    );
    expect(requests).toHaveLength(100);
  });

  it("listReviewThread returns the root and its replies sorted by created_at", async () => {
    const reviewComments = [
      createComment({
        id: 12,
        in_reply_to_id: 10,
        created_at: "2026-11-10T10:05:00Z",
      }),
      createComment({ id: 20, created_at: "2026-11-10T09:00:00Z" }),
      createComment({ id: 10, created_at: "2026-11-10T10:00:00Z" }),
      createComment({
        id: 21,
        in_reply_to_id: 20,
        created_at: "2026-11-10T10:01:00Z",
      }),
      createComment({
        id: 11,
        in_reply_to_id: 10,
        created_at: "2026-11-10T10:02:00Z",
      }),
    ];
    const { client, requests } = createClient(() =>
      Response.json(reviewComments),
    );

    const thread = await client.listReviewThread(TARGET, 10);

    expect(thread.map((c) => c.id)).toEqual([10, 11, 12]);
    expect(requests[0]?.url).toBe(`${REPO}/pulls/7/comments?per_page=100`);
  });
});

describe("GitHubApiClient auth", () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  /** App provider whose token endpoint answers `inst-<installationId>`. */
  function createAppAuth() {
    const fetchImpl: typeof fetch = async (input) => {
      const match = /installations\/(\d+)\/access_tokens$/.exec(String(input));
      return Response.json(
        {
          token: `inst-${match?.[1]}`,
          expires_at: "2099-01-01T00:00:00Z",
        },
        { status: 201 },
      );
    };
    return new GitHubAppTokenProvider({
      appId: 123,
      privateKey,
      apiBaseUrl: API,
      fetch: fetchImpl,
    });
  }

  it("App mode sends the installation token of the target", async () => {
    const { client, requests } = createClient(undefined, {
      auth: createAppAuth(),
    });

    await client.createIssueComment({ ...TARGET, installationId: 77 }, "x");

    expect(requests[0]?.headers.get("authorization")).toBe("Bearer inst-77");
  });

  it("getAuthenticatedBotLogin returns <slug>[bot] from GET /app with the App JWT", async () => {
    const { client, requests } = createClient(
      () => Response.json({ slug: "copilot-helper" }),
      { auth: createAppAuth() },
    );

    const login = await client.getAuthenticatedBotLogin();

    expect(login).toBe("copilot-helper[bot]");
    expect(only(requests)).toMatchObject({ method: "GET", url: `${API}/app` });
    const jwtParts = requests[0]?.headers.get("authorization")?.split(".");
    expect(jwtParts).toHaveLength(3);
  });

  it("getAuthenticatedBotLogin returns the login from GET /user in token mode", async () => {
    const { client, requests } = createClient(() =>
      Response.json({ login: "dev-user" }),
    );

    const login = await client.getAuthenticatedBotLogin();

    expect(login).toBe("dev-user");
    expect(only(requests)).toMatchObject({ method: "GET", url: `${API}/user` });
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer ghp_test");
  });
});

describe("GitHubApiClient errors", () => {
  async function failureOf(response: Response, now?: () => number) {
    const { client } = createClient(() => response, { now });
    const error: unknown = await client.createIssueComment(TARGET, "x").then(
      () => null,
      (e: unknown) => e,
    );
    if (!(error instanceof GitHubApiError)) {
      throw new Error(`expected GitHubApiError, got ${String(error)}`);
    }
    return error;
  }

  it("maps a non-2xx response to GitHubApiError with the GitHub message", async () => {
    const error = await failureOf(
      Response.json({ message: "Not Found" }, { status: 404 }),
    );

    expect(error).toMatchObject({
      status: 404,
      method: "POST",
      path: "/repos/acme/widgets/issues/7/comments",
      message:
        "GitHub POST /repos/acme/widgets/issues/7/comments failed: 404 Not Found",
      retryAfterMs: undefined,
    });
  });

  it("uses the raw body when the error response is not JSON", async () => {
    const error = await failureOf(
      new Response("upstream down", { status: 502 }),
    );

    expect(error.message).toMatch(/502 upstream down$/);
  });

  it("surfaces Retry-After on 429 as retryAfterMs", async () => {
    const error = await failureOf(
      Response.json(
        { message: "slow down" },
        { status: 429, headers: { "retry-after": "30" } },
      ),
    );

    expect(error.retryAfterMs).toBe(30_000);
  });

  it("surfaces the X-RateLimit-Reset delay on an exhausted 403", async () => {
    const error = await failureOf(
      Response.json(
        { message: "API rate limit exceeded" },
        {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1700000090",
          },
        },
      ),
      () => 1_700_000_000_000,
    );

    expect(error.retryAfterMs).toBe(90_000);
  });

  it("leaves retryAfterMs unset on a 403 that is not a rate limit", async () => {
    const error = await failureOf(
      Response.json(
        { message: "Resource not accessible by integration" },
        { status: 403, headers: { "x-ratelimit-remaining": "4999" } },
      ),
    );

    expect(error.retryAfterMs).toBeUndefined();
  });
});
