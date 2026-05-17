import type { KnownBlock } from "@slack/types";
import type { z } from "zod";
import type { FrontendTool, FrontendToolContext } from "./frontend-tools.js";

/**
 * Human-in-the-loop component. The Slack-side equivalent of React's
 * `useHumanInTheLoop` / `useCopilotAction`: the agent calls it like a
 * regular tool, the tool renders an interactive Block Kit message in
 * the thread, then **blocks waiting for the user to click a button**.
 * When the user clicks, the tool resolves with the value the developer
 * bound to that button (via `api.respond(value)`), the agent receives
 * that as the tool result, and the run continues.
 *
 * Render lifecycle (mirrors React's `useCopilotAction({render: ({status,…}) => …})`):
 *
 *   `render` is invoked at every state transition — initially with
 *   `status: "pending"`, then again with `status: "resolved"` /
 *   `"cancelled"` / `"timeout"` once the wait settles. On `"pending"`,
 *   `api.respond(value)` mints `action_id`s bound to the resume value
 *   the user effectively submits if they click that element. On
 *   `"resolved"`, `state.value` is the bound value — typed as
 *   `unknown`; narrow it yourself with property checks or a cast (you
 *   typed the `respond(...)` calls; you know the shape).
 *
 *   The render's return value *replaces* the previously posted message
 *   via Slack's `response_url` (falling back to `chat.update`). Return
 *   `"noop"` to leave the message untouched, or `"delete"` to remove it.
 *
 * Contrast with `defineSlackComponent` (render-only, no interactivity).
 */
export interface HumanInTheLoop<PropsSchema extends z.ZodType = z.ZodType> {
  /** Unique tool-name the agent sees. */
  name: string;
  /** What the LLM reads when deciding to pick this component. */
  description: string;
  /** Zod schema for the props the agent passes in. */
  props: PropsSchema;
  /** Plain-text fallback (notifications). Falls back to `description`. */
  fallbackText?(props: z.infer<PropsSchema>): string;
  /**
   * Build the Block Kit message for the current state. Called once on
   * initial post (`status: "pending"`) and again on each resolution.
   *
   * Return:
   *   - `KnownBlock[]` — post or replace the message with these blocks.
   *   - `"delete"` — remove the message entirely.
   *   - `"noop"` — leave whatever's currently shown (only meaningful on
   *     non-pending states; ignored on `"pending"` since the bridge
   *     must post *something* to show buttons).
   */
  render(
    state: HitlRenderState<PropsSchema>,
    api: HitlRenderApi,
  ): HitlRenderResult;
  /**
   * Optional timeout. If no action fires within this many ms, the tool
   * resolves with `{kind: "timeout"}` instead of an action — the agent
   * can decide how to proceed (give up, ask again, etc.). When omitted
   * the tool waits indefinitely (until the conversation is cancelled).
   */
  timeoutMs?: number;
}

/**
 * Discriminated state passed to `render` at every lifecycle phase. On
 * `"pending"`, `api.respond` mints action_ids bound to specific resume
 * values. On `"resolved"`, `value` is whatever the developer originally
 * bound to the clicked element via `api.respond(value)` — typed as
 * `unknown` (you typed the `respond(...)` calls; narrow at the call site).
 */
export type HitlRenderState<P extends z.ZodType> =
  | { status: "pending"; props: z.infer<P> }
  | { status: "cancelled"; props: z.infer<P> }
  | { status: "timeout"; props: z.infer<P> }
  | { status: "resolved"; props: z.infer<P>; value: unknown };

/** Return shape from `render` — controls what happens to the Slack message. */
export type HitlRenderResult = KnownBlock[] | "delete" | "noop";

/** Render-time helper passed to `render(state, api)`. */
export interface HitlRenderApi {
  /**
   * Mint a unique `action_id` for a Block Kit interactive element and
   * bind it to a resume value. The returned string goes into the
   * element's `action_id` field. When the user clicks (or selects) the
   * element, the wait resolves with `value` — exactly the value passed
   * here. `value` is `unknown` (no schema, no compile-time check); use
   * any shape you'll narrow on in the resolved render.
   */
  respond(value: unknown): string;
}

/**
 * Result of a human-in-the-loop wait — what gets serialised as the
 * tool's return value to the agent. (Distinct from `HitlRenderState`,
 * which is the internal lifecycle the renderer sees.)
 */
export type HitlResult =
  | { kind: "resolved"; value: unknown }
  | { kind: "timeout" }
  | { kind: "cancelled" };

/**
 * Identity factory — returns the component back, but lets TS infer the
 * `PropsSchema` generic from the `props` field.
 */
export function defineHumanInTheLoop<PropsSchema extends z.ZodType>(
  h: HumanInTheLoop<PropsSchema>,
): HumanInTheLoop<PropsSchema> {
  return h;
}

// ── Registry: action_id ↔ pending tool execution ─────────────────────

/**
 * Slack's per-click metadata. The bridge captures this on a successful
 * `block_actions` and passes it to whoever's waiting — the renderer can
 * then `replace_original` via `response_url` instead of needing the
 * channel ts.
 */
export interface SlackClickMetadata {
  responseUrl?: string;
  messageTs?: string;
  channel?: string;
  triggerId?: string;
  userId?: string;
}

interface PendingWait {
  /** Conversation key — used to cancel an in-flight wait on interrupt. */
  conversationKey: string;
  /** Map of action_id → the value bound at render time via api.respond(). */
  actionMap: Map<string, unknown>;
  /** Set when an action fires (or timeout / cancel) — resolves the wait. */
  resolve: (r: HitlResult, click?: SlackClickMetadata) => void;
  /** Optional timer id (only set when `timeoutMs` was specified). */
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Process-local registry. One per bridge. Stores in-flight waits keyed
 * by `action_id`, with a secondary index by `conversationKey` so the
 * turn-runner can cancel everything tied to an interrupted conversation.
 */
export class HumanInTheLoopRegistry {
  private waitByAction = new Map<string, PendingWait>();
  private waitsByConversation = new Map<string, Set<PendingWait>>();
  private idCounter = 0;

  /** Generate a fresh action_id. */
  mintActionId(): string {
    this.idCounter += 1;
    return `hitl-${Date.now().toString(36)}-${this.idCounter}`;
  }

  /**
   * Begin a wait. Returns a Promise that resolves to `{result, click?}`
   * where `click` is the `block_actions` metadata when the wait settled
   * via a user click (so the caller can use `response_url`).
   */
  startWaiting(args: {
    conversationKey: string;
    actionMap: Map<string, unknown>;
    timeoutMs?: number;
  }): Promise<{ result: HitlResult; click?: SlackClickMetadata }> {
    const { conversationKey, actionMap, timeoutMs } = args;
    return new Promise((resolve) => {
      const wait: PendingWait = {
        conversationKey,
        actionMap,
        resolve: (r, click) => {
          if (wait.timer) clearTimeout(wait.timer);
          this.cleanup(wait);
          resolve({ result: r, click });
        },
      };
      if (timeoutMs && timeoutMs > 0) {
        wait.timer = setTimeout(() => {
          wait.resolve({ kind: "timeout" });
        }, timeoutMs);
      }
      for (const actionId of actionMap.keys()) {
        this.waitByAction.set(actionId, wait);
      }
      const set = this.waitsByConversation.get(conversationKey) ?? new Set();
      set.add(wait);
      this.waitsByConversation.set(conversationKey, set);
    });
  }

  /**
   * Called by the Bolt `app.action` handler when Slack delivers a click.
   * Returns true if the click matched a known pending wait. The
   * `decodedClickValue` is what the bridge parsed off the button's
   * `value` field, if any — preferred over the registry-stored value
   * because it survives bridge restarts. Falls back to the registry's
   * stored value when the click didn't carry one (e.g. non-button
   * interactive element).
   */
  handleAction(
    actionId: string,
    click?: SlackClickMetadata,
    decodedClickValue?: unknown,
  ): boolean {
    const wait = this.waitByAction.get(actionId);
    if (!wait) return false;
    const value =
      decodedClickValue !== undefined
        ? decodedClickValue
        : wait.actionMap.has(actionId)
          ? wait.actionMap.get(actionId)
          : undefined;
    wait.resolve({ kind: "resolved", value }, click);
    return true;
  }

  /**
   * Cancel every pending wait for a conversation — used when a new turn
   * arrives for the same conversation and the in-flight run is aborted.
   */
  cancelConversation(conversationKey: string): void {
    const set = this.waitsByConversation.get(conversationKey);
    if (!set) return;
    for (const wait of set) wait.resolve({ kind: "cancelled" });
  }

  private cleanup(wait: PendingWait): void {
    for (const actionId of wait.actionMap.keys()) {
      this.waitByAction.delete(actionId);
    }
    const set = this.waitsByConversation.get(wait.conversationKey);
    if (set) {
      set.delete(wait);
      if (set.size === 0) this.waitsByConversation.delete(wait.conversationKey);
    }
  }
}

/**
 * Walk a block tree and inject `value: JSON.stringify(resumeValue)` on
 * every button whose `action_id` is in `actionMap`. Slack stores this
 * value with the message and echoes it back on click via
 * `block_actions.actions[i].value`, which means a bridge that restarts
 * between picker-post and click can still recover the bound resume
 * value purely from the click payload — no need for the in-memory
 * registry to survive the restart.
 *
 * Buttons are special-cased because that's the Block Kit element that
 * carries a free-form `value`. Other interactive elements (selects,
 * datepickers, etc.) fall back to the registry — restart-survival for
 * those is a phase-2 problem.
 *
 * Per Slack docs, `value` is capped at 2000 chars; we throw if any
 * encoded value exceeds that so the picker post isn't silently rejected
 * by Slack.
 */
export function injectResumeValues(
  blocks: KnownBlock[],
  actionMap: ReadonlyMap<string, unknown>,
): KnownBlock[] {
  return blocks.map(
    (b) =>
      visitBlock(b as Block, (el) => {
        const aid = (el as { action_id?: string }).action_id;
        if (!aid) return el;
        if (!actionMap.has(aid)) return el;
        if ((el as { type?: string }).type !== "button") return el;
        const encoded = JSON.stringify(actionMap.get(aid) ?? null);
        if (encoded.length > 2000) {
          throw new Error(
            `[hitl] resume value for action_id=${aid} encodes to ${encoded.length} chars; Slack's button.value cap is 2000. Carry the heavy data server-side and pass a key here.`,
          );
        }
        return { ...el, value: encoded };
      }) as KnownBlock,
  );
}

type Block = KnownBlock & {
  elements?: Array<Record<string, unknown>>;
  accessory?: Record<string, unknown>;
  element?: Record<string, unknown>;
};

/**
 * Apply a per-element visitor across the standard "elements" / "accessory"
 * / "element" container shapes that Block Kit uses. Returns a new block
 * with the visited children replaced.
 */
function visitBlock(
  block: Block,
  visit: (el: Record<string, unknown>) => Record<string, unknown>,
): Block {
  const next: Block = { ...block };
  if (Array.isArray(block.elements)) {
    next.elements = block.elements.map((el) => visit(el));
  }
  if (block.accessory) {
    next.accessory = visit(block.accessory);
  }
  if (block.element) {
    next.element = visit(block.element);
  }
  return next;
}

/**
 * Apply a render result to Slack. Used for both the initial pending
 * render (always blocks → `chat.postMessage`) and resolution renders
 * (blocks → `response_url` with `replace_original`, `"delete"` →
 * `response_url` with `delete_original`, `"noop"` → no-op).
 *
 * `metadata` is forwarded to `chat.postMessage` only — it lets the
 * bridge persist the interrupt handler name + payload onto the picker
 * itself, so a stale click after a bridge restart can recover the
 * dispatch context purely from `conversations.replies`.
 */
export async function applyRenderResult(args: {
  result: HitlRenderResult;
  text: string;
  ctx: FrontendToolContext;
  click?: SlackClickMetadata;
  existingMessageTs?: string;
  metadata?: { event_type: string; event_payload: Record<string, unknown> };
}): Promise<{ messageTs?: string; deleted: boolean }> {
  const { result, text, ctx, click, existingMessageTs, metadata } = args;
  if (result === "noop")
    return { messageTs: existingMessageTs, deleted: false };
  if (result === "delete") {
    if (click?.responseUrl) {
      await postToResponseUrl(click.responseUrl, { delete_original: true });
      return { deleted: true };
    }
    if (existingMessageTs) {
      try {
        await ctx.client.chat.delete({
          channel: ctx.channel,
          ts: existingMessageTs,
        });
      } catch (err) {
        console.error("[hitl] chat.delete failed:", err);
      }
    }
    return { deleted: true };
  }
  // blocks
  if (click?.responseUrl) {
    await postToResponseUrl(click.responseUrl, {
      replace_original: true,
      text,
      blocks: result,
    });
    return { messageTs: existingMessageTs ?? click.messageTs, deleted: false };
  }
  if (existingMessageTs) {
    await ctx.client.chat.update({
      channel: ctx.channel,
      ts: existingMessageTs,
      text,
      blocks: result,
    });
    return { messageTs: existingMessageTs, deleted: false };
  }
  const r = (await ctx.client.chat.postMessage({
    channel: ctx.channel,
    thread_ts: ctx.threadTs,
    text,
    blocks: result,
    ...(metadata ? { metadata } : {}),
  } as never)) as { ts?: string };
  return { messageTs: r.ts, deleted: false };
}

/** Slack message-metadata `event_type` we use to mark interrupt pickers. */
export const INTERRUPT_PICKER_EVENT_TYPE = "copilotkit_slack_interrupt";

/** Slack message-metadata `event_type` we use to mark HITL pickers. */
export const HITL_PICKER_EVENT_TYPE = "copilotkit_slack_hitl";

async function postToResponseUrl(
  url: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      console.error(
        "[hitl] response_url POST failed:",
        r.status,
        await r.text().catch(() => ""),
      );
    }
  } catch (err) {
    console.error("[hitl] response_url POST threw:", err);
  }
}

/**
 * Adapt a human-in-the-loop component into a regular `FrontendTool` —
 * the LLM sees it as a normal callable. The tool's `execute`:
 *
 *   1. Renders the initial `"pending"` state and posts via `chat.postMessage`.
 *   2. Awaits the registry's wait.
 *   3. Renders the appropriate resolved state and applies the result
 *      (response_url `replace_original` / `delete_original`, or
 *      `chat.update` / `chat.delete` as fallback).
 *   4. Returns the wait result as a JSON tool result so the agent can
 *      branch on `{kind: "resolved", value}` vs timeout / cancel.
 */
export function hitlToFrontendTool<PropsSchema extends z.ZodType>(
  h: HumanInTheLoop<PropsSchema>,
  registry: HumanInTheLoopRegistry,
): FrontendTool<PropsSchema> {
  return {
    name: h.name,
    description: h.description,
    parameters: h.props,
    async execute(props, ctx) {
      const text = h.fallbackText ? h.fallbackText(props) : h.description;

      // ── Initial render ────────────────────────────────────────────
      const pendingActionMap = new Map<string, unknown>();
      const pendingApi: HitlRenderApi = {
        respond(value) {
          const id = registry.mintActionId();
          pendingActionMap.set(id, value);
          return id;
        },
      };
      const pendingResult = h.render(
        { status: "pending", props } as HitlRenderState<PropsSchema>,
        pendingApi,
      );
      if (pendingResult === "noop" || pendingResult === "delete") {
        return JSON.stringify({
          ok: false,
          rendered: h.name,
          error: "render({status:'pending'}) must return KnownBlock[]",
        });
      }
      // Bake the resume values into the buttons themselves so a bridge
      // restart between picker-post and click can still recover.
      const encodedPending = injectResumeValues(
        pendingResult,
        pendingActionMap,
      );
      let messageTs: string | undefined;
      try {
        const r = await applyRenderResult({
          result: encodedPending,
          text,
          ctx,
          // Carry the dispatch context (handler name + the originating
          // props) on the message itself, so a stale click after a
          // bridge restart can rehydrate the resolved-state render and
          // resume the graph purely from Slack.
          metadata: {
            event_type: HITL_PICKER_EVENT_TYPE,
            event_payload: {
              handler: h.name,
              props: props as Record<string, unknown>,
            },
          },
        });
        messageTs = r.messageTs;
      } catch (err) {
        return JSON.stringify({
          ok: false,
          rendered: h.name,
          error: (err as Error).message,
        });
      }

      // ── Wait ──────────────────────────────────────────────────────
      const { result, click } = await registry.startWaiting({
        conversationKey: ctx.conversationKey,
        actionMap: pendingActionMap,
        timeoutMs: h.timeoutMs,
      });

      // ── Resolution render ─────────────────────────────────────────
      const resolvedApi: HitlRenderApi = {
        respond(value) {
          const id = registry.mintActionId();
          // Follow-up waits on resolved state aren't wired yet.
          void value;
          return id;
        },
      };
      const resolvedState: HitlRenderState<PropsSchema> =
        result.kind === "resolved"
          ? { status: "resolved", props, value: result.value }
          : ({ status: result.kind, props } as HitlRenderState<PropsSchema>);
      let resolvedRender: HitlRenderResult;
      try {
        resolvedRender = h.render(resolvedState, resolvedApi);
      } catch (err) {
        console.error("[hitl] resolved render threw:", err);
        resolvedRender = "noop";
      }
      try {
        await applyRenderResult({
          result: resolvedRender,
          text,
          ctx,
          click,
          existingMessageTs: messageTs,
        });
      } catch (err) {
        console.error("[hitl] applying resolved render failed:", err);
      }
      return JSON.stringify({ ok: true, rendered: h.name, result });
    },
  };
}
