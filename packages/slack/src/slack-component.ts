import type { KnownBlock } from "@slack/types";
import type { z } from "zod";
import type { FrontendTool, FrontendToolContext } from "./frontend-tools.js";

/**
 * A Slack-renderable component. The agent-side parallel to React's
 * `useComponent`: the developer declares props (as a Zod schema) and a
 * `render` function that turns those props into Slack Block Kit. The
 * bridge advertises the component to the agent as a regular tool;
 * when the agent calls it, the bridge runs `render` and posts the
 * resulting blocks via `chat.postMessage` in the current thread/DM.
 *
 * The LLM doesn't see a "component" vs "tool" distinction — to it,
 * everything is just a callable. The render-as-Block-Kit behavior is
 * entirely a bridge concern.
 */
export interface SlackComponent<Schema extends z.ZodType = z.ZodType> {
  /** Unique tool-name the agent sees. snake_case is the convention. */
  name: string;
  /**
   * Human-readable description shown to the LLM. The model picks the
   * component based on this, so be specific about *when* to use it.
   */
  description: string;
  /** Zod schema describing the component's props. */
  props: Schema;
  /**
   * Plain-text fallback for mobile notifications and screen readers.
   * Slack requires it whenever a message has `blocks`. If omitted, we
   * use the component's `description` as the fallback — define your own
   * for a more helpful preview.
   *
   * (Declared as a method, not an arrow property, so component subtype
   * assignability stays clean: arrow-property function types are
   * checked contravariantly under `strictFunctionTypes`, which makes
   * `SlackComponent<MyZodSchema>` not assignable to
   * `SlackComponent<ZodType>` — method syntax is bivariant.)
   */
  fallbackText?(props: z.infer<Schema>): string;
  /** Pure function: typed props in, Slack Block Kit blocks out. */
  render(props: z.infer<Schema>): KnownBlock[];
}

/**
 * Identity factory — returns the component back, but lets TypeScript
 * infer the schema generic so callers don't have to write it out
 * explicitly. Mirrors the `defineConfig` / `defineComponent` pattern
 * common in TS libraries.
 */
export function defineSlackComponent<Schema extends z.ZodType>(
  c: SlackComponent<Schema>,
): SlackComponent<Schema> {
  return c;
}

/**
 * Adapt a `SlackComponent` to a `FrontendTool` the turn-runner can
 * register. The tool's `execute` renders the blocks and posts a Slack
 * message; the agent receives an ack JSON it can quote / react to.
 */
export function componentToFrontendTool<Schema extends z.ZodType>(
  c: SlackComponent<Schema>,
): FrontendTool<Schema> {
  return {
    name: c.name,
    description: c.description,
    parameters: c.props,
    async execute(props, ctx) {
      const blocks = c.render(props);
      const text = resolveFallbackText(c, props);
      return postBlocks(ctx, blocks, text, c.name);
    },
  };
}

function resolveFallbackText<Schema extends z.ZodType>(
  c: SlackComponent<Schema>,
  props: z.infer<Schema>,
): string {
  if (c.fallbackText) return c.fallbackText(props);
  return c.description;
}

async function postBlocks(
  ctx: FrontendToolContext,
  blocks: KnownBlock[],
  text: string,
  componentName: string,
): Promise<string> {
  try {
    const r = (await ctx.client.chat.postMessage({
      channel: ctx.channel,
      thread_ts: ctx.threadTs,
      blocks,
      text,
    })) as { ok?: boolean; ts?: string };
    return JSON.stringify({
      ok: true,
      rendered: componentName,
      messageTs: r.ts,
    });
  } catch (err) {
    return JSON.stringify({
      ok: false,
      rendered: componentName,
      error: (err as Error).message,
    });
  }
}
