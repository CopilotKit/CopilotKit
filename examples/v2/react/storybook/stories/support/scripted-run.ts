/**
 * Scripted agent runs played on a clock, as the AG-UI messages a chat would
 * hold at each moment. Lets stories show tool calls arriving, running and
 * finishing without a runtime.
 */
import { useEffect, useMemo, useState } from "react";
import type { Message } from "@copilotkit/react-core/v2";
import { toolCall } from "./fixtures";

interface ScriptCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: string;
  /** Set when the call fails; the tool message carries it as `error`. */
  error?: string;
  /** How long the call runs, in ms. */
  ms: number;
}

type ScriptStep =
  | { kind: "text"; id: string; text: string }
  | { kind: "tool"; call: ScriptCall };

export interface ScriptedRun {
  question: string;
  steps: ScriptStep[];
}

const say = (id: string, text: string): ScriptStep => ({
  kind: "text",
  id,
  text,
});

const call = (
  id: string,
  name: string,
  args: Record<string, unknown>,
  result: string,
  ms: number,
  error?: string,
): ScriptStep => ({
  kind: "tool",
  call: { id, name, args, result, ms, error },
});

/** A coding agent narrating between two bursts of tool calls, one of which fails. */
export const debugBuildRun: ScriptedRun = {
  question: "Why is the checkout build failing on main?",
  steps: [
    say("debug-1", "I'll start with the failing job."),
    call(
      "debug-c1",
      "run_command",
      { command: "gh run view 8412 --log-failed" },
      "checkout.test.ts › creates a payment intent\n  Error: STRIPE_KEY is not defined",
      1300,
    ),
    call(
      "debug-c2",
      "read_file",
      { path: "src/checkout/stripe.ts" },
      "import Stripe from 'stripe';\nexport const stripe = new Stripe(process.env.STRIPE_KEY!);",
      700,
    ),
    call(
      "debug-c3",
      "run_command",
      { command: "git log -3 --oneline -- src/checkout" },
      "a41c2e9 move Stripe client to a server-only module\n9f03b1d add checkout analytics\n51ce8aa bump stripe to 17.4",
      900,
    ),
    say(
      "debug-2",
      "The Stripe client now reads `STRIPE_KEY` as soon as it's imported. Checking where that variable is set.",
    ),
    call(
      "debug-c4",
      "search_code",
      { query: "STRIPE_KEY" },
      "3 matches: .env.example, src/checkout/stripe.ts, turbo.json",
      800,
    ),
    call(
      "debug-c5",
      "run_command",
      { command: "vercel env ls" },
      "Error: No project linked. Run `vercel link` first.",
      900,
      "No project linked",
    ),
    call(
      "debug-c6",
      "run_command",
      { command: "vercel env ls --cwd apps/web" },
      "STRIPE_KEY               Production\nSTRIPE_PUBLISHABLE_KEY   Production, Preview",
      1100,
    ),
    call(
      "debug-c7",
      "read_file",
      { path: "turbo.json" },
      '{\n  "globalEnv": ["STRIPE_PUBLISHABLE_KEY"]\n}',
      700,
    ),
    say(
      "debug-answer",
      "The build fails because `STRIPE_KEY` never reaches the test run.\n\n- `a41c2e9` moved the Stripe client into a module that reads `STRIPE_KEY` when it's imported, so the checkout tests now need it.\n- `STRIPE_KEY` is only set for **Production** in Vercel, and `turbo.json` doesn't pass it through `globalEnv`, so CI runs without it.\n\nAdd `STRIPE_KEY` to `globalEnv` and set a test key for Preview. Want me to open a PR?",
    ),
  ],
};

/**
 * Generic calls mixed with `search` and `calculator`, which the stories'
 * `demoToolRenderers` draw as cards of their own.
 */
export const pricingExperimentRun: ScriptedRun = {
  question:
    "How did the Q3 pricing experiment do, and what's it worth over a year?",
  steps: [
    say("pricing-1", "Pulling the experiment data first."),
    call(
      "pricing-c1",
      "run_query",
      {
        sql: "select variant, visitors, conversions from experiments where name = 'q3-pricing'",
      },
      "control        24,180 visitors   508 conversions\nannual-first   24,020 visitors   625 conversions",
      1200,
    ),
    call(
      "pricing-c2",
      "run_query",
      {
        sql: "select avg(order_value) from orders where created_at >= '2026-07-01'",
      },
      "129.40",
      800,
    ),
    call(
      "pricing-c3",
      "search",
      { query: "Q3 pricing experiment write-up", filters: ["2026", "growth"] },
      "Found 3 experiment write-ups.",
      1000,
    ),
    say(
      "pricing-2",
      "Annual-first lifts conversion from 2.1% to 2.6%. Estimating the yearly revenue at current traffic:",
    ),
    call(
      "pricing-c4",
      "calculator",
      { expression: "290000 * 0.005 * 129.40" },
      "187,630",
      900,
    ),
    say(
      "pricing-answer",
      "The annual-first variant wins: **2.6% vs 2.1%** conversion on about 24k visitors each. At current traffic (about 290k visitors a year) and a $129.40 average order, that's roughly **$188k** in extra revenue a year. The growth team's write-up recommends rolling it out to every region.",
    ),
  ],
};

const LEAD_MS = 600;
const GAP_MS = 220;
const WORD_MS = 30;

const words = (value: string) => value.match(/\S+\s*/g) ?? [value];

function schedule(steps: ScriptStep[]) {
  let cursor = LEAD_MS;
  const timed = steps.map((step) => {
    const duration =
      step.kind === "text" ? words(step.text).length * WORD_MS : step.call.ms;
    const entry = { step, start: cursor, end: cursor + duration };
    cursor = entry.end + GAP_MS;
    return entry;
  });
  return { timed, total: cursor };
}

/** The messages a chat holds `t` ms into the run: each call is its own message. */
function messagesAt(
  run: ScriptedRun,
  timed: ReturnType<typeof schedule>["timed"],
  t: number,
): Message[] {
  const messages: Message[] = [
    { id: "question", role: "user", content: run.question },
  ];
  for (const { step, start, end } of timed) {
    if (start > t) break;
    const finished = t >= end;
    if (step.kind === "text") {
      const all = words(step.text);
      const shown = finished
        ? all.length
        : Math.max(1, Math.floor((t - start) / WORD_MS));
      messages.push({
        id: step.id,
        role: "assistant",
        content: all.slice(0, shown).join(""),
      });
      continue;
    }
    const { id, name, args, result, error } = step.call;
    messages.push({
      id: `${id}-message`,
      role: "assistant",
      content: "",
      toolCalls: [toolCall(id, name, args)],
    });
    if (finished) {
      messages.push({
        id: `${id}-result`,
        role: "tool",
        toolCallId: id,
        content: result,
        ...(error ? { error } : {}),
      });
    }
  }
  return messages;
}

/**
 * Plays `run` from the start each time `runKey` changes, or shows it finished
 * when `live` is false.
 */
export function useScriptedRun(
  run: ScriptedRun,
  live: boolean,
  runKey: number,
): { messages: Message[]; isRunning: boolean } {
  const { timed, total } = useMemo(() => schedule(run.steps), [run]);
  const [t, setT] = useState(live ? 0 : Infinity);

  useEffect(() => {
    if (!live) {
      setT(Infinity);
      return;
    }
    const startedAt = performance.now();
    setT(0);
    const timer = setInterval(() => {
      const elapsed = performance.now() - startedAt;
      setT(elapsed >= total ? Infinity : elapsed);
      if (elapsed >= total) clearInterval(timer);
    }, 40);
    return () => clearInterval(timer);
  }, [live, runKey, total]);

  const messages = useMemo(() => messagesAt(run, timed, t), [run, timed, t]);
  return { messages, isRunning: t < total };
}
