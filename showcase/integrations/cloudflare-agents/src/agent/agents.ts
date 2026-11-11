/**
 * The showcase's Cloudflare agents: Agents SDK `Agent`s (Durable Objects)
 * made AG-UI-capable by `withAGUI` from `@ag-ui/cloudflare-agents`. Each AG-UI
 * thread is one instance of its class, and the agent's `state` is the
 * thread's shared state.
 *
 * The split mirrors the Strands TypeScript sibling's backend: one shared agent
 * (`Showcase`) serves most demos, which differ only in what the page
 * registers (frontend tools, renderers, context); the rest each need their
 * own prompt, tools or model API.
 */
import { Agent } from "agents";
import { isAGUIRequest, withAGUI } from "@ag-ui/cloudflare-agents";
import type { AGUIRun } from "@ag-ui/cloudflare-agents";
import { stepCountIs, streamText } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import {
  DASHBOARD_CATALOG_ID,
  SALES_CATALOG_ID,
  SALES_GUIDELINES,
  displayFlightTool,
  generateA2uiTool,
  withoutRenderTool,
} from "./a2ui";
import {
  chatModelId,
  chatProviderOptions,
  openaiFor,
  reasoningModelId,
} from "./model";
import type { ModelEnv } from "./model";
import {
  A2UI_DYNAMIC_SYSTEM_PROMPT,
  A2UI_FIXED_SYSTEM_PROMPT,
  BYOC_HASHBROWN_SYSTEM_PROMPT,
  BYOC_JSON_RENDER_SYSTEM_PROMPT,
  INTERRUPT_SYSTEM_PROMPT,
  REASONING_CHAIN_SYSTEM_PROMPT,
  REASONING_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  VOICE_SYSTEM_PROMPT,
} from "./prompts";
import { reasoningChainTools } from "./reasoning";
import { scheduleMeetingTool, translateSchedulingResume } from "./scheduling";
import type { MeetingChoice } from "./scheduling";
import { showcaseTools } from "./tools";
import type { ShowcaseState } from "./tools";

export type Env = ModelEnv & Record<string, unknown>;

type Run = AGUIRun<ShowcaseState>;
type ProviderOptions = Parameters<typeof streamText>[0]["providerOptions"];

/** What every agent shares: the model, the page's tools, the run loop. */
abstract class ShowcaseAgentBase extends withAGUI(Agent<Env, ShowcaseState>) {
  initialState: ShowcaseState = {};

  /** The agent's own instructions. */
  protected abstract readonly prompt: string;

  /** Model steps per run: tool calls plus the closing message. */
  protected readonly maxSteps: number = 10;

  /** The agent's server tools. */
  protected tools(_run: Run): ToolSet {
    return {};
  }

  /** Server tools that wait for the user (AI SDK `toolApproval`: an AG-UI interrupt). */
  protected readonly approvalRequired: string[] = [];

  /** The page's tools. A server tool of the same name wins. */
  protected clientTools(run: Run): ToolSet {
    return run.clientTools;
  }

  protected openai(run: Run) {
    return openaiFor(this.env, run.request);
  }

  /** Chat Completions, so tool arguments stream (aimock serves it too). */
  protected model(run: Run): LanguageModel {
    return this.openai(run).chat(chatModelId(this.env));
  }

  protected providerOptions(): ProviderOptions {
    return chatProviderOptions(chatModelId(this.env));
  }

  onAGUIRun(run: Run) {
    return streamText({
      model: this.model(run),
      instructions: run.instructions(this.prompt),
      messages: run.messages,
      tools: { ...this.clientTools(run), ...this.tools(run) },
      toolApproval: Object.fromEntries(
        this.approvalRequired.map((name) => [name, "user-approval" as const]),
      ),
      providerOptions: this.providerOptions(),
      stopWhen: stepCountIs(this.maxSteps),
      abortSignal: run.abortSignal,
    });
  }

  /** The state accessor the tools write through. */
  protected stateAccess() {
    return {
      get: () => this.state,
      set: (state: ShowcaseState) => this.setState(state),
    };
  }
}

/**
 * The shared agent: chat, server tools, shared state, sub-agents. gen-ui-agent
 * walks seven `set_steps` calls before its summary, hence the step budget.
 */
export class Showcase extends ShowcaseAgentBase {
  protected readonly prompt = SYSTEM_PROMPT;
  protected readonly maxSteps = 25;

  protected tools(run: Run): ToolSet {
    return showcaseTools({
      state: this.stateAccess(),
      model: () => this.model(run),
      providerOptions: this.providerOptions(),
    });
  }
}

/**
 * beautiful-chat: the shared agent plus the backend-owned `generate_a2ui` for
 * dashboards on the page's `app-dashboard-catalog` (its route sets
 * `injectA2UITool: false`).
 */
export class BeautifulChat extends Showcase {
  protected tools(run: Run): ToolSet {
    return {
      ...super.tools(run),
      generate_a2ui: generateA2uiTool({
        model: () => this.model(run),
        providerOptions: this.providerOptions(),
        defaultCatalogId: DASHBOARD_CATALOG_ID,
        context: run.context,
        messages: run.input.messages,
        state: this.state,
      }),
    };
  }

  protected clientTools(run: Run): ToolSet {
    return withoutRenderTool(run.clientTools);
  }
}

/** voice: transcription happens in the route; the agent only chats. */
export class Voice extends ShowcaseAgentBase {
  protected readonly prompt = VOICE_SYSTEM_PROMPT;
}

/** declarative-hashbrown: replies with the hashbrown `{ "ui": [...] }` envelope. */
export class ByocHashbrown extends ShowcaseAgentBase {
  protected readonly prompt = BYOC_HASHBROWN_SYSTEM_PROMPT;
}

/** declarative-json-render: replies with a `@json-render/react` flat spec. */
export class ByocJsonRender extends ShowcaseAgentBase {
  protected readonly prompt = BYOC_JSON_RENDER_SYSTEM_PROMPT;
}

/** a2ui-fixed-schema: `display_flight` returns a pre-authored surface. */
export class A2uiFixedSchema extends ShowcaseAgentBase {
  protected readonly prompt = A2UI_FIXED_SYSTEM_PROMPT;

  protected tools(): ToolSet {
    return { display_flight: displayFlightTool() };
  }
}

/**
 * declarative-gen-ui: `generate_a2ui` designs a surface on the page's sales
 * catalog. The page's catalog makes the runtime inject its `render_a2ui`
 * client tool; this agent drops it so the model calls `generate_a2ui`.
 */
export class DeclarativeGenUi extends ShowcaseAgentBase {
  protected readonly prompt = A2UI_DYNAMIC_SYSTEM_PROMPT;

  protected tools(run: Run): ToolSet {
    return {
      generate_a2ui: generateA2uiTool({
        model: () => this.model(run),
        providerOptions: this.providerOptions(),
        defaultCatalogId: SALES_CATALOG_ID,
        guidelines: SALES_GUIDELINES,
        context: run.context,
        messages: run.input.messages,
        state: this.state,
      }),
    };
  }

  protected clientTools(run: Run): ToolSet {
    return withoutRenderTool(run.clientTools);
  }
}

/**
 * a2ui-recovery: the same `generate_a2ui`; its fixtures make the render
 * sub-agent heal on a retry, or fail every attempt and return the
 * recovery-exhausted envelope.
 */
export class A2uiRecovery extends DeclarativeGenUi {}

/**
 * gen-ui-interrupt and interrupt-headless: `schedule_meeting` pauses for the
 * user's pick (AI SDK `toolApproval`, an AG-UI interrupt). The pages resume
 * with the picked slot rather than `{ approved }`; `translateSchedulingResume`
 * rewrites the resume before the adapter reads it (see ./scheduling.ts).
 */
export class Interrupt extends ShowcaseAgentBase {
  protected readonly prompt = INTERRUPT_SYSTEM_PROMPT;
  protected readonly approvalRequired = ["schedule_meeting"];
  private readonly choices = new Map<string, MeetingChoice>();

  protected tools(): ToolSet {
    return { schedule_meeting: scheduleMeetingTool(this.choices) };
  }

  async onRequest(request: Request): Promise<Response> {
    if (!isAGUIRequest(request)) return super.onRequest(request);
    const body = await request.text();
    // The same request (method, headers, signal) with the given body.
    const withBody = (text: string) =>
      new Request(request, { method: request.method, body: text });
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      // Not JSON: the adapter answers it with a 400.
      return super.onRequest(withBody(body));
    }
    const translated = translateSchedulingResume(input, this.choices);
    return super.onRequest(withBody(JSON.stringify(translated)));
  }
}

/**
 * reasoning-default and reasoning-custom: a reasoning model on the Responses
 * API, which streams reasoning summaries (REASONING_* events).
 */
export class Reasoning extends ShowcaseAgentBase {
  protected readonly prompt = REASONING_SYSTEM_PROMPT;

  protected model(run: Run): LanguageModel {
    return this.openai(run).responses(reasoningModelId(this.env));
  }

  protected providerOptions(): ProviderOptions {
    // `detailed`: with `auto` the model often skips the summary when tools
    // are in play, which leaves the page's reasoning slot empty. `store:
    // false` keeps every request self-contained (aimock has no stored items).
    return {
      openai: {
        reasoningEffort: "medium",
        reasoningSummary: "detailed",
        store: false,
      },
    };
  }
}

/** tool-rendering-reasoning-chain: chains mock tools while it reasons. */
export class ReasoningChain extends Reasoning {
  protected readonly prompt = REASONING_CHAIN_SYSTEM_PROMPT;

  protected tools(): ToolSet {
    return reasoningChainTools();
  }
}
