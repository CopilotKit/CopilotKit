import { afterEach, describe, expect, it, vi } from "vitest";
import { LinearApiClient, LinearApiError } from "./client.js";

interface RecordedRequest {
  url: string;
  method: string | undefined;
  authorization: string | null;
  contentType: string | null;
  operation: string | undefined;
  variables: Record<string, unknown>;
}

interface GraphQLRequestBody {
  query: string;
  variables: Record<string, unknown>;
}

/** A fake fetch that records each request and answers with the next queued response. */
function fakeLinear(responses: Array<() => Response>) {
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const body: GraphQLRequestBody = JSON.parse(String(init?.body));
    requests.push({
      url: String(input),
      method: init?.method,
      authorization: headers.get("authorization"),
      contentType: headers.get("content-type"),
      operation: /^\s*((?:query|mutation)\s+\w+)/.exec(body.query)?.[1],
      variables: body.variables,
    });
    const next = responses.shift();
    if (!next) throw new Error("fakeLinear: no response queued");
    return next();
  };
  const client = new LinearApiClient({
    accessToken: "lin_tok",
    fetch: fetchImpl,
  });
  return { client, requests };
}

function json(body: unknown, init: ResponseInit = {}) {
  return () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
      ...init,
    });
}

interface ActivityNodeFixture {
  id: string;
  createdAt: string;
  signal: string | null;
  user: { id: string };
  content: Record<string, string | null>;
}

function activityNode(
  overrides: Partial<ActivityNodeFixture> &
    Pick<ActivityNodeFixture, "id" | "createdAt" | "content">,
) {
  return { signal: null, user: { id: "user-1" }, ...overrides };
}

function activitiesPage(
  nodes: ActivityNodeFixture[],
  endCursor: string | null,
) {
  return {
    nodes,
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
  };
}

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof LinearApiError)) {
    throw new Error(`expected LinearApiError, got ${String(error)}`);
  }
  return error;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("LinearApiClient.createActivity", () => {
  it("posts agentActivityCreate to the Linear endpoint with app-token auth and returns the id", async () => {
    const { client, requests } = fakeLinear([
      json({
        data: {
          agentActivityCreate: {
            success: true,
            agentActivity: { id: "act-9" },
          },
        },
      }),
    ]);

    const ref = await client.createActivity("sess-1", {
      type: "response",
      body: "Done.",
    });

    expect(ref).toEqual({ id: "act-9" });
    expect(requests).toEqual([
      {
        url: "https://api.linear.app/graphql",
        method: "POST",
        authorization: "Bearer lin_tok",
        contentType: "application/json",
        operation: "mutation AgentActivityCreate",
        variables: {
          input: {
            agentSessionId: "sess-1",
            content: { type: "response", body: "Done." },
          },
        },
      },
    ]);
  });

  it("passes ephemeral, signal, and signalMetadata through in the input", async () => {
    const { client, requests } = fakeLinear([
      json({
        data: {
          agentActivityCreate: {
            success: true,
            agentActivity: { id: "act-2" },
          },
        },
      }),
    ]);

    await client.createActivity(
      "sess-1",
      { type: "elicitation", body: "Pick one" },
      {
        ephemeral: false,
        signal: "select",
        signalMetadata: { options: [{ value: "Yes" }, { value: "No" }] },
      },
    );

    expect(requests[0]?.variables).toEqual({
      input: {
        agentSessionId: "sess-1",
        content: { type: "elicitation", body: "Pick one" },
        ephemeral: false,
        signal: "select",
        signalMetadata: { options: [{ value: "Yes" }, { value: "No" }] },
      },
    });
  });

  it("uses a custom apiUrl", async () => {
    const requests: string[] = [];
    const client = new LinearApiClient({
      accessToken: "lin_tok",
      apiUrl: "https://linear.test/graphql",
      fetch: async (input) => {
        requests.push(String(input));
        return json({
          data: {
            agentActivityCreate: { success: true, agentActivity: { id: "a" } },
          },
        })();
      },
    });

    await client.createActivity("sess-1", { type: "thought", body: "hm" });

    expect(requests).toEqual(["https://linear.test/graphql"]);
  });

  it("throws LinearApiError when the mutation reports success: false", async () => {
    const { client } = fakeLinear([
      json({
        data: {
          agentActivityCreate: { success: false, agentActivity: { id: "a" } },
        },
      }),
    ]);

    const error = await rejection(
      client.createActivity("sess-1", { type: "thought", body: "hm" }),
    );

    expect(error.message).toBe(
      "Linear agentActivityCreate returned success: false",
    );
  });
});

describe("LinearApiClient.getSession", () => {
  it("pages through activities with the end cursor and returns them oldest first", async () => {
    const { client, requests } = fakeLinear([
      json({
        data: {
          agentSession: {
            id: "sess-1",
            issue: {
              id: "iss-1",
              identifier: "ENG-7",
              title: "Fix login",
              description: null,
              url: "https://linear.app/acme/issue/ENG-7",
            },
            activities: activitiesPage(
              [
                activityNode({
                  id: "a2",
                  createdAt: "2026-11-10T10:00:02.000Z",
                  user: { id: "app-user" },
                  content: {
                    type: "action",
                    action: "Searching",
                    parameter: "login bug",
                    result: null,
                  },
                }),
                activityNode({
                  id: "a1",
                  createdAt: "2026-11-10T10:00:01.000Z",
                  content: { type: "prompt", body: "Why does login fail?" },
                }),
              ],
              "cursor-1",
            ),
          },
        },
      }),
      json({
        data: {
          agentSession: {
            activities: activitiesPage(
              [
                activityNode({
                  id: "a3",
                  createdAt: "2026-11-10T10:00:03.000Z",
                  user: { id: "app-user" },
                  content: { type: "response", body: "The token expired." },
                }),
                activityNode({
                  id: "a4",
                  createdAt: "2026-11-10T10:00:04.000Z",
                  signal: "stop",
                  content: { type: "prompt", body: "Stop" },
                }),
              ],
              null,
            ),
          },
        },
      }),
    ]);

    const session = await client.getSession("sess-1");

    expect(session).toEqual({
      id: "sess-1",
      issue: {
        id: "iss-1",
        identifier: "ENG-7",
        title: "Fix login",
        url: "https://linear.app/acme/issue/ENG-7",
      },
      activities: [
        {
          id: "a1",
          createdAt: "2026-11-10T10:00:01.000Z",
          userId: "user-1",
          content: { type: "prompt", body: "Why does login fail?" },
        },
        {
          id: "a2",
          createdAt: "2026-11-10T10:00:02.000Z",
          userId: "app-user",
          content: {
            type: "action",
            action: "Searching",
            parameter: "login bug",
          },
        },
        {
          id: "a3",
          createdAt: "2026-11-10T10:00:03.000Z",
          userId: "app-user",
          content: { type: "response", body: "The token expired." },
        },
        {
          id: "a4",
          createdAt: "2026-11-10T10:00:04.000Z",
          userId: "user-1",
          content: { type: "prompt", body: "Stop" },
          signal: "stop",
        },
      ],
    });
    expect(
      requests.map(({ operation, variables }) => ({ operation, variables })),
    ).toEqual([
      {
        operation: "query AgentSession",
        variables: { id: "sess-1", first: 100 },
      },
      {
        operation: "query AgentSessionActivities",
        variables: { id: "sess-1", first: 100, after: "cursor-1" },
      },
    ]);
  });

  it("omits the issue for a session without one", async () => {
    const { client } = fakeLinear([
      json({
        data: {
          agentSession: {
            id: "sess-2",
            issue: null,
            activities: activitiesPage([], null),
          },
        },
      }),
    ]);

    expect(await client.getSession("sess-2")).toEqual({
      id: "sess-2",
      activities: [],
    });
  });

  it("stops after 10 pages when Linear keeps reporting more", async () => {
    const page = (n: number) =>
      activitiesPage(
        [
          activityNode({
            id: `a${n}`,
            createdAt: `2026-11-10T10:00:${String(n).padStart(2, "0")}.000Z`,
            content: { type: "prompt", body: `m${n}` },
          }),
        ],
        `cursor-${n}`,
      );
    const responses = [
      json({
        data: { agentSession: { id: "s", issue: null, activities: page(0) } },
      }),
      ...Array.from({ length: 20 }, (_, i) =>
        json({ data: { agentSession: { activities: page(i + 1) } } }),
      ),
    ];
    const { client, requests } = fakeLinear(responses);

    const session = await client.getSession("s");

    expect(requests).toHaveLength(10);
    expect(session.activities).toHaveLength(10);
    expect(requests[9]?.variables).toEqual({
      id: "s",
      first: 100,
      after: "cursor-8",
    });
  });

  it("skips activities whose content type it does not know", async () => {
    const { client } = fakeLinear([
      json({
        data: {
          agentSession: {
            id: "s",
            issue: null,
            activities: activitiesPage(
              [
                activityNode({
                  id: "x",
                  createdAt: "2026-11-10T10:00:00.000Z",
                  content: { type: "plan", body: "future type" },
                }),
                activityNode({
                  id: "y",
                  createdAt: "2026-11-10T10:00:01.000Z",
                  content: { type: "thought", body: "thinking" },
                }),
              ],
              null,
            ),
          },
        },
      }),
    ]);

    const session = await client.getSession("s");

    expect(session.activities.map((activity) => activity.id)).toEqual(["y"]);
  });
});

describe("LinearApiClient.getViewer", () => {
  it("queries the viewer and returns its id and name", async () => {
    const { client, requests } = fakeLinear([
      json({ data: { viewer: { id: "app-user", name: "CopilotKit" } } }),
    ]);

    expect(await client.getViewer()).toEqual({
      id: "app-user",
      name: "CopilotKit",
    });
    expect(requests[0]?.operation).toBe("query Viewer");
    expect(requests[0]?.variables).toEqual({});
  });
});

describe("LinearApiClient access token", () => {
  it("calls a token function before every request", async () => {
    const tokens = ["lin_first", "lin_second"];
    const authorizations: Array<string | null> = [];
    const client = new LinearApiClient({
      accessToken: async () => tokens.shift() ?? "lin_exhausted",
      fetch: async (_input, init) => {
        authorizations.push(new Headers(init?.headers).get("authorization"));
        return json({ data: { viewer: { id: "app-user", name: "Bot" } } })();
      },
    });

    await client.getViewer();
    await client.getViewer();

    expect(authorizations).toEqual(["Bearer lin_first", "Bearer lin_second"]);
  });
});

describe("LinearApiError mapping", () => {
  it("maps an HTTP error with a non-JSON body", async () => {
    const { client } = fakeLinear([
      () =>
        new Response("<html>bad gateway</html>", {
          status: 502,
          statusText: "Bad Gateway",
        }),
    ]);

    const error = await rejection(client.getViewer());

    expect(error.message).toBe("Linear API request failed: 502 Bad Gateway");
    expect(error.status).toBe(502);
    expect(error.errors).toEqual([]);
    expect(error.rateLimited).toBe(false);
    expect(error.retryAfterMs).toBeUndefined();
  });

  it("maps GraphQL errors returned with HTTP 200", async () => {
    const graphQLErrors = [
      {
        message: "Entity not found: AgentSession",
        path: ["agentSession"],
        extensions: { code: "INVALID_INPUT" },
      },
    ];
    const { client } = fakeLinear([
      json({ data: null, errors: graphQLErrors }),
    ]);

    const error = await rejection(client.getSession("missing"));

    expect(error.message).toBe(
      "Linear API request failed: 200 Entity not found: AgentSession",
    );
    expect(error.status).toBe(200);
    expect(error.errors).toEqual(graphQLErrors);
    expect(error.rateLimited).toBe(false);
  });

  it("reports a RATELIMITED error with the time until the request quota resets", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T10:00:00.000Z"));
    const resetAt = Date.parse("2026-11-10T10:00:45.000Z");
    const { client } = fakeLinear([
      json(
        {
          errors: [
            {
              message: "Rate limit exceeded",
              extensions: { code: "RATELIMITED" },
            },
          ],
        },
        {
          status: 400,
          headers: { "X-RateLimit-Requests-Reset": String(resetAt) },
        },
      ),
    ]);

    const error = await rejection(client.getViewer());

    expect(error.status).toBe(400);
    expect(error.rateLimited).toBe(true);
    expect(error.retryAfterMs).toBe(45_000);
  });

  it("reads Retry-After seconds on HTTP 429", async () => {
    const { client } = fakeLinear([
      () =>
        new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": "30" },
        }),
    ]);

    const error = await rejection(client.getViewer());

    expect(error.rateLimited).toBe(true);
    expect(error.retryAfterMs).toBe(30_000);
  });
});
