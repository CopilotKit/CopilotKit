import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventType, HttpAgent } from "@ag-ui/client";
import type { AgentSubscriber, RunAgentParameters } from "@ag-ui/client";
import { createChannel, FakeAgent } from "@copilotkit/channels-core";
import type { Channel } from "@copilotkit/channels-core";
import { Actions, Button } from "@copilotkit/channels-ui";
import { linear } from "./adapter.js";
import type { LinearAdapter } from "./adapter.js";
import type {
  AgentActivityContent,
  AgentActivitySignal,
  AgentSessionEventWebhook,
  LinearWebhookAgentActivity,
} from "./types.js";

/**
 * End to end through `createChannel`: signed webhooks go in through
 * `adapter.handleWebhook`, a scripted agent runs, and the activities land on a
 * fake Linear GraphQL endpoint. Only the network and the agent are faked.
 */

const SECRET = "whsec_test";
const SESSION_ID = "ses_1";
const PROMPT_CONTEXT =
  '<issue identifier="ENG-42"><title>Checkout fails on Safari</title></issue>';
const ada = { id: "user_1", name: "Ada Lovelace", email: "ada@acme.dev" };
const issue = {
  id: "iss_1",
  identifier: "ENG-42",
  title: "Checkout fails on Safari",
  description: null,
  url: "https://linear.app/acme/issue/ENG-42",
};

/** The `input` of one `agentActivityCreate` call, as Linear receives it. */
interface PostedActivity {
  agentSessionId: string;
  content: AgentActivityContent;
  ephemeral?: boolean;
  signal?: AgentActivitySignal;
  signalMetadata?: { options: Array<{ value: string }> };
}

interface GraphQLRequest {
  query: string;
  variables: { id?: string; input?: PostedActivity };
}

/** One scripted `runAgent` step (channels-core does not export the type). */
type FakeAgentScriptStep = NonNullable<
  ConstructorParameters<typeof FakeAgent>[0]
>[number];

/** An activity node of the session, as Linear returns it from `agentSession`. */
interface ActivityNode {
  id: string;
  createdAt: string;
  signal: AgentActivitySignal | null;
  user: { id: string };
  content: AgentActivityContent | { type: "prompt"; body: string };
}

/**
 * Fake Linear GraphQL endpoint. Records every posted activity and keeps the
 * session's non-ephemeral activities, so history reads see what was posted.
 */
function fakeLinearApi() {
  const posted: PostedActivity[] = [];
  const nodes: ActivityNode[] = [];
  let seq = 0;
  let heldPost: { released: Promise<void>; onArrived: () => void } | undefined;
  const nextNode = () => {
    seq += 1;
    return {
      id: `act_${seq}`,
      createdAt: new Date(Date.UTC(2026, 10, 10, 9) + seq * 1000).toISOString(),
    };
  };
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const request: GraphQLRequest = JSON.parse(String(init?.body));
    const input = request.variables.input;
    if (input !== undefined) {
      const hold = heldPost;
      heldPost = undefined;
      hold?.onArrived();
      await hold?.released;
      posted.push(input);
      const node = nextNode();
      if (!input.ephemeral) {
        nodes.push({
          ...node,
          signal: input.signal ?? null,
          user: { id: "app_user" },
          content: input.content,
        });
      }
      return Response.json({
        data: {
          agentActivityCreate: {
            success: true,
            agentActivity: { id: node.id },
          },
        },
      });
    }
    return Response.json({
      data: {
        agentSession: {
          id: request.variables.id,
          issue,
          activities: {
            nodes,
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    });
  };
  /** The user's message as Linear stores it before sending `prompted`. */
  const addPrompt = (body: string, signal: AgentActivitySignal | null) => {
    const node = { ...nextNode(), signal, user: { id: ada.id } };
    nodes.push({ ...node, content: { type: "prompt", body } });
    return node.id;
  };
  /**
   * Hold the next posted activity in flight until `release` runs. Linear
   * records it only then, the way a slow request lands late. `arrived`
   * resolves once that post reaches the API.
   */
  const holdNextPost = () => {
    let release = () => {};
    let onArrived = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const arrived = new Promise<void>((resolve) => {
      onArrived = resolve;
    });
    heldPost = { released, onArrived };
    return { release, arrived };
  };
  return { fetch, posted, addPrompt, holdNextPost };
}

/**
 * FakeAgent that records the messages it was started with. The channel runs
 * every turn on a `clone()`, so the clone must stay a RecordingAgent.
 */
class RecordingAgent extends FakeAgent {
  seenMessages: Array<{ role: string; content: unknown }> = [];

  constructor(
    private readonly steps: FakeAgentScriptStep[],
    private readonly runs: RecordingAgent[],
  ) {
    super(steps);
  }

  override async runAgent(
    parameters?: RunAgentParameters,
    subscriber?: AgentSubscriber,
  ) {
    this.runs.push(this);
    this.seenMessages = this.messages.map(({ role, content }) => ({
      role,
      content,
    }));
    return super.runAgent(parameters, subscriber);
  }

  override clone() {
    const cloned = new RecordingAgent(this.steps, this.runs);
    cloned.threadId = this.threadId;
    cloned.messages = structuredClone(this.messages);
    return cloned;
  }
}

const subscriberBase = {
  messages: [],
  state: {},
  agent: new HttpAgent({ url: "http://agent.test" }),
  input: {
    threadId: "thread-1",
    runId: "run-1",
    messages: [],
    tools: [],
    context: [],
    forwardedProps: {},
  },
};

/** Agent step: one complete assistant text message. */
function say(text: string): FakeAgentScriptStep {
  return async (s) => {
    const messageId = "msg_1";
    s.onTextMessageStartEvent?.({
      ...subscriberBase,
      event: {
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
      },
    });
    s.onTextMessageContentEvent?.({
      ...subscriberBase,
      event: { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text },
      textMessageBuffer: text,
    });
    await s.onTextMessageEndEvent?.({
      ...subscriberBase,
      event: { type: EventType.TEXT_MESSAGE_END, messageId },
      textMessageBuffer: text,
    });
  };
}

/** Agent step: one finished tool call. */
function callTool(
  toolCallName: string,
  toolCallArgs: Record<string, unknown>,
): FakeAgentScriptStep {
  return async (s) => {
    await s.onToolCallEndEvent?.({
      ...subscriberBase,
      event: { type: EventType.TOOL_CALL_END, toolCallId: "call_1" },
      toolCallName,
      toolCallArgs,
    });
  };
}

function sign(body: string) {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

function deliver(
  adapter: LinearAdapter,
  payload: AgentSessionEventWebhook,
  signature?: string,
) {
  const body = JSON.stringify(payload);
  return adapter.handleWebhook(
    new Request("http://localhost/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": signature ?? sign(body),
      },
      body,
    }),
  );
}

function createdEvent(): AgentSessionEventWebhook {
  return {
    type: "AgentSessionEvent",
    action: "created",
    organizationId: "org_1",
    createdAt: "2026-11-10T09:00:00.000Z",
    webhookTimestamp: Date.now(),
    agentSession: {
      id: SESSION_ID,
      issue: { ...issue, description: undefined },
      comment: { id: "com_1", body: "@agent can you look at this?" },
      creator: ada,
    },
    promptContext: PROMPT_CONTEXT,
  };
}

function promptedEvent(
  agentActivity: LinearWebhookAgentActivity,
): AgentSessionEventWebhook {
  return {
    type: "AgentSessionEvent",
    action: "prompted",
    organizationId: "org_1",
    createdAt: "2026-11-10T09:05:00.000Z",
    webhookTimestamp: Date.now(),
    agentSession: { id: SESSION_ID, creator: ada },
    agentActivity,
  };
}

const activeChannels: Channel[] = [];

async function startLinear(setup: {
  steps?: FakeAgentScriptStep[];
  handler: Parameters<Channel["onMention"]>[0];
}) {
  const api = fakeLinearApi();
  const adapter = linear({
    accessToken: "lin_oauth_test",
    webhookSecret: SECRET,
    apiUrl: "https://linear.test/graphql",
    fetch: api.fetch,
  });
  const runs: RecordingAgent[] = [];
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent: () => new RecordingAgent(setup.steps ?? [], runs),
  });
  channel.onMention(setup.handler);
  await channel.ɵruntime.start();
  activeChannels.push(channel);

  /** The user sends a message (or a stop) into the session. */
  const prompt = (body: string, signal?: AgentActivitySignal) => {
    const id = api.addPrompt(body, signal ?? null);
    return deliver(
      adapter,
      promptedEvent({
        id,
        user: ada,
        content: { type: "prompt", body },
        ...(signal ? { signal } : {}),
      }),
    );
  };
  return { adapter, api, runs, prompt };
}

/** Wait (bounded) until `done()` holds; webhook dispatch runs after the 200. */
async function until(done: () => boolean) {
  for (let i = 0; i < 200 && !done(); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(done()).toBe(true);
}

function contentTypes(posted: PostedActivity[]) {
  return posted.map((activity) => activity.content.type);
}

describe("LinearAdapter end to end", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    while (activeChannels.length > 0) {
      await activeChannels.pop()!.ɵruntime.stop();
    }
  });

  it("acknowledges a created session with a thought, then posts the agent's answer as a response", async () => {
    let done = false;
    const { adapter, api, runs } = await startLinear({
      steps: [say("It is a CSP header.")],
      handler: async ({ thread }) => {
        await thread.runAgent();
        done = true;
      },
    });

    const res = await deliver(adapter, createdEvent());
    await until(() => done);

    expect(res.status).toBe(200);
    expect(api.posted).toEqual([
      {
        agentSessionId: SESSION_ID,
        content: { type: "thought", body: "Looking into this…" },
        ephemeral: true,
      },
      {
        agentSessionId: SESSION_ID,
        content: { type: "response", body: "It is a CSP header." },
      },
    ]);
    expect(runs.map((run) => run.seenMessages)).toEqual([
      [
        {
          role: "user",
          content:
            "Linear issue ENG-42: Checkout fails on Safari\n" +
            "URL: https://linear.app/acme/issue/ENG-42",
        },
        { role: "user", content: PROMPT_CONTEXT },
      ],
    ]);
  });

  it("posts a tool call as an action activity", async () => {
    let done = false;
    const { adapter, api } = await startLinear({
      steps: [callTool("searchCode", { query: "csp" })],
      handler: async ({ thread }) => {
        await thread.runAgent();
        done = true;
      },
    });

    await deliver(adapter, createdEvent());
    await until(() => done);

    expect(api.posted.at(-1)).toEqual({
      agentSessionId: SESSION_ID,
      content: {
        type: "action",
        action: "searchCode",
        parameter: '{"query":"csp"}',
      },
    });
  });

  it("asks with a select elicitation and resolves awaitChoice from the user's pick", async () => {
    const outcome: { chosen?: unknown } = {};
    const { adapter, api, prompt } = await startLinear({
      handler: async ({ thread }) => {
        outcome.chosen = await thread.awaitChoice(
          Actions({
            children: [
              Button({ value: "ship", children: "Ship it" }),
              Button({ value: "hold", children: "Hold" }),
            ],
          }),
        );
      },
    });

    await deliver(adapter, createdEvent());
    await until(() => contentTypes(api.posted).includes("elicitation"));

    expect(api.posted.at(-1)).toEqual({
      agentSessionId: SESSION_ID,
      content: { type: "elicitation", body: "Choose an option." },
      signal: "select",
      signalMetadata: { options: [{ value: "Ship it" }, { value: "Hold" }] },
    });

    await prompt("Hold");
    await until(() => outcome.chosen !== undefined);

    expect(outcome.chosen).toBe("hold");
  });

  it("aborts a slow run on the stop signal and confirms with one final response", async () => {
    let releaseAgent = () => {};
    const agentGate = new Promise<void>((resolve) => {
      releaseAgent = resolve;
    });
    let done = false;
    const { adapter, api, runs, prompt } = await startLinear({
      steps: [
        async (s) => {
          await agentGate;
          await say("Too late.")(s);
        },
      ],
      handler: async ({ thread }) => {
        await thread.runAgent();
        done = true;
      },
    });

    await deliver(adapter, createdEvent());
    await until(() => runs.length === 1);
    await prompt("Stop", "stop");
    await until(() => runs[0]!.aborted);
    releaseAgent();
    await until(() => done);

    // The aborted run posts nothing; the stop is confirmed by one response.
    expect(contentTypes(api.posted)).toEqual(["thought", "response"]);
    expect(api.posted[1]?.content).toEqual({
      type: "response",
      body: "Stopped.",
    });
  });

  it("does not start the created turn when the stop arrives while the first thought is posted", async () => {
    let started = false;
    const { adapter, api, runs, prompt } = await startLinear({
      steps: [say("Should not run.")],
      handler: async ({ thread }) => {
        started = true;
        await thread.runAgent();
      },
    });
    const thought = api.holdNextPost();

    const created = deliver(adapter, createdEvent());
    // The first thought, not the stop's response, must take the hold.
    await thought.arrived;
    await prompt("Stop", "stop");
    await until(() => contentTypes(api.posted).includes("response"));
    thought.release();
    await created;
    await until(() => api.posted.length === 2);
    await new Promise((r) => setTimeout(r, 20));

    expect({ started, runs: runs.length }).toEqual({ started: false, runs: 0 });
    expect(api.posted.map((activity) => activity.content)).toEqual([
      { type: "response", body: "Stopped." },
      { type: "thought", body: "Looking into this…" },
    ]);
  });

  it("posts Stopped. after an activity that was still in flight when the run finished", async () => {
    const { adapter, api, prompt } = await startLinear({
      handler: async () => {},
    });
    const renderer = adapter.createRunRenderer({
      organizationId: "org_1",
      agentSessionId: SESSION_ID,
    });
    const { release: releasePost } = api.holdNextPost();
    void callTool("search_issues", { query: "safari" })(renderer.subscriber);
    const finishing = renderer.finish();

    await prompt("Stop", "stop");
    await new Promise((r) => setTimeout(r, 20));
    releasePost();
    await finishing;
    await until(() => contentTypes(api.posted).includes("response"));

    expect(api.posted.map((activity) => activity.content)).toEqual([
      {
        type: "action",
        action: "search_issues",
        parameter: '{"query":"safari"}',
      },
      { type: "response", body: "Stopped." },
    ]);
  });

  it("rejects a webhook with a bad signature and starts no run", async () => {
    const handler = vi.fn();
    const { adapter, api } = await startLinear({ handler });

    const res = await deliver(adapter, createdEvent(), "0".repeat(64));
    await new Promise((r) => setTimeout(r, 20));

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(api.posted).toEqual([]);
  });
});
