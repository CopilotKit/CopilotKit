import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { fetchExpenseCsv } from "@/skins/banking/harness/csv";
import { buildHarnessPrompt } from "@/skins/banking/harness/prompt";
import { createExpenseHarnessStream } from "@/skins/banking/harness/run";
import { prepareWorkspace } from "@/skins/banking/harness/workspace";
import { EXPENSE_PILL_MESSAGE } from "@/skins/banking/suggestions";

/**
 * ARM C. A SECOND agent slot in factory mode, routing between two engines.
 *
 * SERVER-SAFE — no "use client", no JSX. Reached only through
 * `src/shell/agent-registry.ts`, never from a client module. The one import that
 * looks client-ish, `./suggestions`, is a plain `.ts` module whose only import is
 * `import type` — the boundary holds.
 *
 * WHY TWO ENGINES: `codexText` spawns a subprocess with a workspace. Routing
 * EVERY turn through it would make "what's on my screen?" a sandbox launch. So
 * ordinary turns go to a normal chat adapter carrying whatever tools the
 * frontend forwarded, and only the expense job pays for a harness.
 *
 * WHY BANKING'S CLASSIC AGENT IS UNTOUCHED: `BuiltInAgentConfiguration` is a
 * strict union of classic | factory, so a factory-mode banking agent would take
 * its 300-line prompt and ~20 frontend tools offline. A separate slot avoids
 * that entirely — every existing banking beat keeps working.
 *
 * WHAT ARM C GETS THAT ARM A DOES NOT: the harness's own events reach the thread
 * through `convertTanStackStream`, so the journey is IN the thread rather than
 * on a side channel — it survives a reload and replays. Gate 2 measured that
 * conversion as pass-through-minus-envelopes (91 raw chunks in → 74 AG-UI events
 * out, every text byte balancing). Three consequences that are Arm C's, recorded
 * where the code lives:
 *
 *  1. `TOOL_CALL_END.input` DOES NOT SURVIVE the converter — the only argument
 *     payload left is `TOOL_CALL_ARGS.delta`, the JSON string. This is the exact
 *     OPPOSITE of the raw-side advice Arm A acted on (`as-tool.ts` renders on
 *     TOOL_CALL_END using `input`, which is right for the raw stream). Nothing
 *     here reads tool arguments, and that is deliberate: the shell's wildcard
 *     tool-call chip gets its `args` from the client's accumulation of
 *     TOOL_CALL_ARGS deltas, which is the surviving path. Do NOT add a renderer
 *     for this agent that reads `input` — it will be undefined, every time.
 *  2. `CUSTOM` is dropped entirely, so `sandbox.file` and `codex.session-id` do
 *     not exist here. Arm C has TWO motion channels where Arm A has three. That
 *     is a real datum for the comparison, not a defect to paper over.
 *  3. All assistant text collapses into ONE minted messageId, so codex's several
 *     messages render as one run-on bubble. Reasoning is unaffected — each
 *     thought keeps its own id.
 */

/** The only part of a run's input this router reads. */
interface RoutableInput {
  messages?: readonly { role: string; content?: unknown }[];
}

/**
 * Deterministic route: exact-match the pill's message, the same idiom banking
 * already uses for its Q2 invoice beat. NOT model-decided — a mis-route is a
 * visible failure in both directions (a chat turn spawning a sandbox, or the
 * expense job answered conversationally with no harness).
 *
 * Matches the LAST USER message rather than the last message of any role: an
 * assistant reply after the pill must not stop the run being routed, and an
 * earlier pill in history must not re-launch a four-minute run on every
 * follow-up turn.
 *
 * A freely-typed variation falls through to the chat adapter, which answers
 * conversationally. That is the accepted limitation of a demo router; the pill
 * is the supported path.
 */
export const shouldRouteToHarness = (input: RoutableInput): boolean => {
  // `toReversed` rather than `reverse`: the input's message array belongs to the
  // run, and reversing it in place would reorder the conversation the factory is
  // about to hand to the chat adapter.
  const lastUser = (input.messages ?? [])
    .toReversed()
    .find((message) => message.role === "user");
  return (
    typeof lastUser?.content === "string" &&
    lastUser.content.trim() === EXPENSE_PILL_MESSAGE.trim()
  );
};

/**
 * The ordinary-turn model.
 *
 * NOT banking's `openai/gpt-5.4`: that is a CopilotKit alias resolved by the
 * runtime, and this adapter takes a raw id from its own union — where `gpt-5.4`
 * does not exist (`OPENAI_CHAT_MODELS` in `@tanstack/ai-openai`'s model-meta has
 * `gpt-5.4-mini`/`-nano`/`-image-2` but no plain `gpt-5.4`). `gpt-5.6` is the
 * closest general chat model in that union and the same family as the harness's
 * own `gpt-5.6-sol`. The comparison this arm exists for is about the STREAMING
 * SEAM, not about model quality, so an exact match with banking's classic agent
 * is not load-bearing.
 */
const CHAT_MODEL = "gpt-5.6";

export const bankingHarnessAgent = () =>
  new BuiltInAgent({
    type: "tanstack",
    factory: async (ctx) => {
      if (shouldRouteToHarness(ctx.input)) {
        const { dir } = await prepareWorkspace(await fetchExpenseCsv());
        return createExpenseHarnessStream({
          dir,
          prompt: buildHarnessPrompt(),
          // The run's own signal — abandoning the turn kills the codex process
          // group. Arm A had to build this by hand because `defineTool.execute`
          // has no cancellation hook; here the runtime hands it over.
          abortSignal: ctx.abortSignal,
        });
      }

      // Ordinary turn. `convertInputToTanStackAI` folds the frontend's context
      // entries and application state into `systemPrompts` (so banking's
      // on-screen readables carry over) and maps `input.tools` to client-side
      // tools the browser executes — the CopilotKit round-trip.
      const { messages, systemPrompts, tools } = convertInputToTanStackAI(
        ctx.input,
      );
      return chat({
        // `openaiText` takes NO apiKey argument — its second parameter is
        // `Omit<OpenAITextConfig, "apiKey">`; it reads OPENAI_API_KEY from the
        // environment itself and throws if it is absent. That throw happens
        // per-run, inside this factory, so a missing key surfaces as a failed
        // turn rather than a server that will not boot.
        adapter: openaiText(CHAT_MODEL),
        messages,
        systemPrompts,
        tools,
        // `chat()` takes an AbortController, NOT a signal — the same trap
        // `run.ts` documents on the harness side. The factory context hands one
        // over precisely for this ("provided for backends like TanStack AI that
        // require the full AbortController"), so no adapter is needed here.
        abortController: ctx.abortController,
      }) as AsyncIterable<unknown>;
    },
  });
