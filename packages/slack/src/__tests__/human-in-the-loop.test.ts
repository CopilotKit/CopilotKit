import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  defineHumanInTheLoop,
  hitlToFrontendTool,
  HumanInTheLoopRegistry,
  retryDelayMs,
} from "../human-in-the-loop.js";
import type { FrontendToolContext } from "../frontend-tools.js";

function makeCtx(): {
  ctx: FrontendToolContext;
  postFn: ReturnType<typeof vi.fn>;
  updateFn: ReturnType<typeof vi.fn>;
  deleteFn: ReturnType<typeof vi.fn>;
} {
  const postFn = vi.fn(async () => ({ ok: true, ts: "1700.0" }));
  const updateFn = vi.fn(async () => ({ ok: true }));
  const deleteFn = vi.fn(async () => ({ ok: true }));
  const ctx = {
    client: {
      chat: { postMessage: postFn, update: updateFn, delete: deleteFn },
    } as never,
    channel: "C1",
    threadTs: "100.0",
    botUserId: "BOT01",
    conversationKey: "C1::100.0",
  } satisfies FrontendToolContext;
  return { ctx, postFn, updateFn, deleteFn };
}

const confirmHitl = defineHumanInTheLoop({
  name: "confirm",
  description: "Ask the user to confirm an action",
  props: z.object({ question: z.string() }),
  render(state, api) {
    if (state.status === "pending") {
      return [
        {
          type: "section",
          text: { type: "mrkdwn", text: state.props.question },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Yes" },
              action_id: api.respond({ confirmed: true }),
            },
            {
              type: "button",
              text: { type: "plain_text", text: "No" },
              action_id: api.respond({ confirmed: false }),
            },
          ],
        },
      ];
    }
    if (state.status === "resolved") {
      const v = state.value as { confirmed: boolean };
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: v.confirmed
              ? `:white_check_mark: Confirmed: ${state.props.question}`
              : `:x: Declined: ${state.props.question}`,
          },
        },
      ];
    }
    if (state.status === "cancelled") return "delete";
    return "noop";
  },
});

describe("HumanInTheLoopRegistry", () => {
  it("mints unique action ids", () => {
    const r = new HumanInTheLoopRegistry();
    const ids = new Set([r.mintActionId(), r.mintActionId(), r.mintActionId()]);
    expect(ids.size).toBe(3);
  });

  it("resolves a wait with the bound value when a matching action arrives", async () => {
    const r = new HumanInTheLoopRegistry();
    const idA = r.mintActionId();
    const idB = r.mintActionId();
    const actionMap = new Map<string, unknown>([
      [idA, { confirmed: true }],
      [idB, { confirmed: false }],
    ]);
    const promise = r.startWaiting({ conversationKey: "k", actionMap });
    expect(r.handleAction(idA)).toBe(true);
    const { result } = await promise;
    expect(result).toEqual({ kind: "resolved", value: { confirmed: true } });
  });

  it("returns false for an unknown action_id (stale or never-registered)", () => {
    const r = new HumanInTheLoopRegistry();
    expect(r.handleAction("nope")).toBe(false);
  });

  it("propagates Slack click metadata (response_url etc.) through to the waiter", async () => {
    const r = new HumanInTheLoopRegistry();
    const id = r.mintActionId();
    const promise = r.startWaiting({
      conversationKey: "k",
      actionMap: new Map<string, unknown>([[id, { ok: true }]]),
    });
    r.handleAction(id, {
      responseUrl: "https://hooks.slack.com/x",
      messageTs: "1.0",
    });
    const { result, click } = await promise;
    expect(result.kind).toBe("resolved");
    expect(click?.responseUrl).toBe("https://hooks.slack.com/x");
    expect(click?.messageTs).toBe("1.0");
  });

  it("times out cleanly when timeoutMs is set", async () => {
    vi.useFakeTimers();
    const r = new HumanInTheLoopRegistry();
    const id = r.mintActionId();
    const promise = r.startWaiting({
      conversationKey: "k",
      actionMap: new Map<string, unknown>([[id, { confirmed: true }]]),
      timeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(60);
    const { result } = await promise;
    expect(result).toEqual({ kind: "timeout" });
    vi.useRealTimers();
  });

  it("cancelConversation resolves all pending waits for that key with kind:cancelled", async () => {
    const r = new HumanInTheLoopRegistry();
    const id = r.mintActionId();
    const promise = r.startWaiting({
      conversationKey: "K",
      actionMap: new Map<string, unknown>([[id, { confirmed: true }]]),
    });
    r.cancelConversation("K");
    const { result } = await promise;
    expect(result.kind).toBe("cancelled");
  });

  it("after resolution, the action_id is no longer registered (stale clicks)", async () => {
    const r = new HumanInTheLoopRegistry();
    const id = r.mintActionId();
    const promise = r.startWaiting({
      conversationKey: "K",
      actionMap: new Map<string, unknown>([[id, { confirmed: true }]]),
    });
    r.handleAction(id);
    await promise;
    expect(r.handleAction(id)).toBe(false);
  });
});

describe("hitlToFrontendTool — full lifecycle", () => {
  it("posts pending blocks, then on click re-renders resolved state via chat.update", async () => {
    const registry = new HumanInTheLoopRegistry();
    const tool = hitlToFrontendTool(confirmHitl, registry);
    const { ctx, postFn, updateFn } = makeCtx();
    const execPromise = tool.handler({ question: "Proceed?" }, ctx);

    await new Promise((r) => setTimeout(r, 0));
    expect(postFn).toHaveBeenCalledTimes(1);
    const arg = postFn.mock.calls[0]?.[0];
    const buttons = (arg.blocks[1].elements ?? []) as Array<{
      action_id: string;
      text: { text: string };
    }>;
    expect(buttons.map((b) => b.text.text)).toEqual(["Yes", "No"]);

    // Click "Yes". No response_url provided → falls back to chat.update.
    const yesId = buttons[0]!.action_id;
    expect(registry.handleAction(yesId)).toBe(true);

    const r = JSON.parse((await execPromise) as string);
    expect(r.ok).toBe(true);
    expect(r.result).toEqual({ kind: "resolved", value: { confirmed: true } });
    // Resolved render produces a new section block, applied via chat.update.
    expect(updateFn).toHaveBeenCalledTimes(1);
    const updateArg = updateFn.mock.calls[0]?.[0];
    expect(updateArg.ts).toBe("1700.0");
    expect(updateArg.blocks[0].text.text).toContain("Confirmed: Proceed?");
  });

  it("uses response_url replace_original when the click carries one", async () => {
    const registry = new HumanInTheLoopRegistry();
    const tool = hitlToFrontendTool(confirmHitl, registry);
    const { ctx, updateFn } = makeCtx();
    const fetchMock = vi.fn(async () => new Response("ok"));
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;
    const execPromise = tool.handler({ question: "Proceed?" }, ctx);
    await new Promise((r) => setTimeout(r, 0));
    const allActions = Array.from(
      (
        registry as unknown as { waitByAction: Map<string, unknown> }
      ).waitByAction.keys(),
    );
    const yesId = allActions[0]!;
    registry.handleAction(yesId, { responseUrl: "https://hooks.slack.com/x" });
    await execPromise;
    expect(fetchMock).toHaveBeenCalled();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("https://hooks.slack.com/x");
    const body = JSON.parse(init.body as string);
    expect(body.replace_original).toBe(true);
    expect(body.blocks[0].text.text).toContain("Confirmed: Proceed?");
    expect(updateFn).not.toHaveBeenCalled();
  });

  it("retries a response_url POST on 429, honoring Retry-After", async () => {
    const registry = new HumanInTheLoopRegistry();
    const tool = hitlToFrontendTool(confirmHitl, registry);
    const { ctx } = makeCtx();
    // First hit is rate-limited (Retry-After: 0 → immediate retry), second succeeds.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "0" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok"));
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;
    const execPromise = tool.handler({ question: "Proceed?" }, ctx);
    await new Promise((r) => setTimeout(r, 0));
    const yesId = Array.from(
      (
        registry as unknown as { waitByAction: Map<string, unknown> }
      ).waitByAction.keys(),
    )[0]!;
    registry.handleAction(yesId, { responseUrl: "https://hooks.slack.com/x" });
    await execPromise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns "delete" → posts delete_original via response_url (fallback: chat.delete)', async () => {
    const registry = new HumanInTheLoopRegistry();
    const tool = hitlToFrontendTool(confirmHitl, registry);
    const { ctx, deleteFn } = makeCtx();
    const execPromise = tool.handler({ question: "X?" }, ctx);
    await new Promise((r) => setTimeout(r, 0));
    // Cancel via a non-action path — the renderer returns "delete".
    registry.cancelConversation(ctx.conversationKey);
    await execPromise;
    // No responseUrl on cancel → fallback chat.delete.
    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(deleteFn.mock.calls[0]?.[0]?.ts).toBe("1700.0");
  });

  it("returns ok:false if chat.postMessage throws before any wait begins", async () => {
    const registry = new HumanInTheLoopRegistry();
    const tool = hitlToFrontendTool(confirmHitl, registry);
    const ctx = {
      client: {
        chat: {
          postMessage: vi.fn(async () => {
            throw new Error("rate_limited");
          }),
        },
      } as never,
      channel: "C1",
      botUserId: "BOT01",
      conversationKey: "C1::100.0",
    } satisfies FrontendToolContext;
    const r = JSON.parse(
      (await tool.handler({ question: "X" }, ctx)) as string as string,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("rate_limited");
  });
});

describe("retryDelayMs (response_url Retry-After)", () => {
  it("honors a finite Retry-After header (delta-seconds → ms)", () => {
    expect(retryDelayMs("2", 0)).toBe(2000);
    expect(retryDelayMs("0", 1)).toBe(0);
  });

  it("clamps a huge Retry-After so it can't hang the turn", () => {
    // A hostile/buggy 999999s header must not sleep ~11 days.
    expect(retryDelayMs("999999", 0)).toBe(30_000);
  });

  it("falls back to linear per-attempt backoff when the header is absent or invalid", () => {
    expect(retryDelayMs(null, 0)).toBe(1000);
    expect(retryDelayMs(null, 2)).toBe(3000);
    // HTTP-date form (Slack sends delta-seconds) → NaN → fallback.
    expect(retryDelayMs("Wed, 21 Oct 2025 07:28:00 GMT", 0)).toBe(1000);
  });

  it("treats a negative Retry-After as an immediate retry", () => {
    expect(retryDelayMs("-5", 0)).toBe(0);
  });
});
