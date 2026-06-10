import type { KnownBlock } from "@slack/types";
import type { ObjectSchema, InferSchemaOutput } from "./standard-schema.js";
import type { FrontendTool, FrontendToolContext } from "./frontend-tools.js";

/**
 * A Slack-renderable component. The agent-side parallel to React's
 * `useComponent`: the developer declares props (as a Standard Schema)
 * and a `render` function that turns those props into Slack Block Kit. The
 * bridge advertises the component to the agent as a regular tool;
 * when the agent calls it, the bridge runs `render` and posts the
 * resulting blocks via `chat.postMessage` in the current thread/DM.
 *
 * The LLM doesn't see a "component" vs "tool" distinction — to it,
 * everything is just a callable. The render-as-Block-Kit behavior is
 * entirely a bridge concern.
 */
export interface SlackComponent<Schema extends ObjectSchema = ObjectSchema> {
  /** Unique tool-name the agent sees. snake_case is the convention. */
  name: string;
  /**
   * Human-readable description shown to the LLM. The model picks the
   * component based on this, so be specific about *when* to use it.
   */
  description: string;
  /** Standard Schema (Zod, Valibot, ArkType, …) describing the props. */
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
   * `SlackComponent<MySchema>` not assignable to
   * `SlackComponent<ObjectSchema>` — method syntax is bivariant.)
   */
  fallbackText?(props: InferSchemaOutput<Schema>): string;
  /**
   * Optional accent color (hex, e.g. `#5E6AD2`), or a function of the props
   * for a data-driven color (e.g. red for an urgent issue). When set, the
   * rendered blocks are posted inside a message *attachment* with this
   * `color`, which gives the card a rounded container with a colored left
   * border — the "nice card" look (Block Kit blocks alone have no border).
   * Return `undefined` (or omit) for a plain, borderless message.
   */
  accentColor?:
    | string
    | ((props: InferSchemaOutput<Schema>) => string | undefined);
  /** Pure function: typed props in, Slack Block Kit blocks out. */
  render(props: InferSchemaOutput<Schema>): KnownBlock[];
}

/**
 * Identity factory — returns the component back, but lets TypeScript
 * infer the schema generic so callers don't have to write it out
 * explicitly. Mirrors the `defineConfig` / `defineComponent` pattern
 * common in TS libraries.
 */
export function defineSlackComponent<Schema extends ObjectSchema>(
  c: SlackComponent<Schema>,
): SlackComponent<Schema> {
  return c;
}

/**
 * Adapt a `SlackComponent` to a `FrontendTool` the turn-runner can
 * register. The tool's `handler` renders the blocks and posts a Slack
 * message; the agent receives an ack JSON it can quote / react to.
 */
export function componentToFrontendTool<Schema extends ObjectSchema>(
  c: SlackComponent<Schema>,
): FrontendTool<Schema> {
  return {
    name: c.name,
    description: c.description,
    parameters: c.props,
    async handler(props, ctx) {
      const blocks = c.render(props);
      const text = resolveFallbackText(c, props);
      const accent =
        typeof c.accentColor === "function"
          ? c.accentColor(props)
          : c.accentColor;
      return postBlocks(ctx, blocks, text, c.name, accent);
    },
  };
}

function resolveFallbackText<Schema extends ObjectSchema>(
  c: SlackComponent<Schema>,
  props: InferSchemaOutput<Schema>,
): string {
  if (c.fallbackText) return c.fallbackText(props);
  return c.description;
}

async function postBlocks(
  ctx: FrontendToolContext,
  blocks: KnownBlock[],
  text: string,
  componentName: string,
  accentColor?: string,
): Promise<string> {
  try {
    // With an accent color, wrap the blocks in an attachment so Slack draws
    // the rounded card + colored left border. Without one, post the blocks
    // at top level (borderless).
    const message = accentColor
      ? { attachments: [{ color: accentColor, blocks, fallback: text }] }
      : { blocks };
    const r = (await ctx.client.chat.postMessage({
      channel: ctx.channel,
      thread_ts: ctx.threadTs,
      text,
      ...message,
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
