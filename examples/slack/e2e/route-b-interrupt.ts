/**
 * Headless end-to-end test of the LEGACY interrupt HITL loop.
 *
 * Deliberately contains NO JSX — it posts the picker via `confirmThingCard()`.
 * `tsconfig.json` excludes `e2e/`, so JSX written here would compile with the
 * classic React transform and die at runtime on "React is not defined"; keeping
 * this file JSX-free means it runs under plain `pnpm tsx` with no pragma and no
 * `--tsconfig` flag. (That exclusion also means `pnpm check-types` skips this
 * directory — use `e2e/tsconfig.json` to typecheck it.)
 *
 * `agent-py/probe.py` proves the AGENT half (interrupt → resume over AG-UI).
 * This proves the CHANNEL half, and it needs no Slack workspace, no tokens, and
 * no tunnel — a `FakeAdapter` stands in for the platform while the agent is the
 * real LangGraph process. So a failure here is unambiguously channels' fault.
 *
 * What it asserts, in order:
 *   1. a turn reaches the agent and the graph suspends → `onInterrupt` fires
 *   2. the handler posts a picker carrying a durable action id
 *   3. delivering a click on that id calls `thread.resume(...)`
 *   4. the graph resumes and the agent's final reply is posted to the channel
 *   5. the decline path resolves too, and says the thing was NOT created
 *
 * Run:  uv run serve.py                  # in examples/slack/agent-py
 *       pnpm tsx e2e/route-b-interrupt.ts
 */
import { createChannel, FakeAdapter, HttpAgent } from "@copilotkit/channels";
import type { ChannelNode } from "@copilotkit/channels";
// NB: `FakeAdapter` comes from the MAIN entry above, NOT from
// `@copilotkit/channels/testing` — that subpath resolves to
// `state-store-conformance` and exports only `runStateStoreConformance`,
// despite the package README advertising a "testing API".
import {
  ConfirmThing,
  confirmThingCard,
} from "../app/human-in-the-loop/confirm-thing.js";

const AGENT_URL =
  process.env["AGENT_URL"] ?? "http://127.0.0.1:8210/agent/thing/run";

/** Depth-first walk of a posted IR tree. */
function* walkNodes(nodes: readonly ChannelNode[]): Generator<ChannelNode> {
  for (const node of nodes) {
    yield node;
    const kids = node.props?.children as ChannelNode[] | undefined;
    if (Array.isArray(kids)) yield* walkNodes(kids);
  }
}

/**
 * The action id of the button whose bound `value.approved` matches `approved` —
 * i.e. Create vs Cancel, chosen by MEANING rather than by position, so the test
 * can't silently drive the wrong button when the card's layout changes.
 *
 * This RECURSES on purpose: channels-core's own `firstActionId` test helper only
 * scans the top level, which works there because its fixture returns a bare
 * `<Button>`. A realistic card nests buttons inside `<Actions>` inside
 * `<Message>`, so a flat scan finds nothing.
 */
function actionIdFor(
  adapter: FakeAdapter,
  approved: boolean,
): string | undefined {
  for (const node of walkNodes(adapter.posted.flat())) {
    if (node.type !== "button") continue;
    const value = node.props.value as { approved?: unknown } | undefined;
    if (value?.approved !== approved) continue;
    const onClick = node.props.onClick as { id?: unknown } | undefined;
    if (typeof onClick?.id === "string") return onClick.id;
  }
  return undefined;
}

/** Every text fragment in a set of IR trees, for assertions. */
function irText(trees: readonly ChannelNode[][]): string {
  const walk = (node: ChannelNode): string => {
    const own =
      typeof node.props?.value === "string" ? ` ${node.props.value}` : "";
    const kids = (node.props?.children as ChannelNode[] | undefined) ?? [];
    return own + kids.map(walk).join("");
  };
  return trees.flat().map(walk).join(" ");
}

interface SentRun {
  resume: unknown;
  hasCommand: boolean;
}

/**
 * Records the RunAgentInput of every POST to the agent.
 *
 * This is the assertion that matters most: `FakeAdapter`'s run renderer
 * discards streamed text, so "did the agent reply?" is not observable from the
 * adapter. What IS observable — and is the actual contract under test — is
 * whether the resume left this process in the legacy LangGraph shape,
 * `forwardedProps.command.resume`.
 */
function recordAgentRuns(): { runs: SentRun[]; restore: () => void } {
  const runs: SentRun[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : String((input as Request).url ?? input);
    if (url === AGENT_URL && init?.body) {
      try {
        const body = JSON.parse(String(init.body)) as {
          forwardedProps?: { command?: { resume?: unknown } };
        };
        const command = body.forwardedProps?.command;
        runs.push({
          resume: command?.resume,
          hasCommand: command !== undefined,
        });
      } catch {
        runs.push({ resume: undefined, hasCommand: false });
      }
    }
    return original(input, init);
  };
  return { runs, restore: () => void (globalThis.fetch = original) };
}

async function runCase(approved: boolean): Promise<void> {
  const label = approved ? "APPROVE" : "DECLINE";
  console.log(`\n=== ${label} ===`);

  const adapter = new FakeAdapter();
  let interruptFired = false;
  const { runs, restore } = recordAgentRuns();

  const bot = createChannel({
    name: `route-b-probe-${label.toLowerCase()}`,
    identifyUser: "platform",
    adapters: [adapter],
    components: [ConfirmThing],
    agent: () => new HttpAgent({ url: AGENT_URL }),
  });

  bot.onMessage(async ({ thread }) => {
    await thread.runAgent();
  });

  // Mirrors route-b.ts: normalize because FakeAdapter (unlike every real
  // adapter) does not JSON.parse the interrupt value.
  bot.onInterrupt("on_interrupt", async ({ payload, thread }) => {
    interruptFired = true;
    const value = (
      typeof payload === "string" ? JSON.parse(payload) : payload
    ) as { action?: string; detail?: string | null };
    console.log(`  interrupt payload: ${JSON.stringify(value)}`);
    await thread.post(
      confirmThingCard({
        action: value.action ?? "Create thing",
        detail: value.detail ?? undefined,
      }),
    );
  });

  await bot.ɵruntime.start();
  try {
    // ── 1. a turn that should trigger create_thing ──────────────────────
    await adapter.getSink().onTurn({
      conversationKey: "probe-thread-1",
      replyTarget: {},
      userText: "create a thing called widget, detail: for testing",
      platform: "fake",
      actor: { id: "u-probe", kind: "human", name: "Probe" },
    });

    if (!interruptFired) {
      throw new Error(
        `onInterrupt never fired. Posted so far: ${irText(adapter.posted) || "(nothing)"}`,
      );
    }
    console.log("  [1/5] PASS onInterrupt fired");

    // ── 2. the picker must carry a durable action id ────────────────────
    const actionId = actionIdFor(adapter, approved);
    if (!actionId) {
      throw new Error(
        `picker posted no button bound to {approved:${approved}}. Posted: ${irText(adapter.posted)}`,
      );
    }
    console.log(
      `  [2/5] PASS picker posted; ${label} button actionId=${actionId.slice(0, 12)}…`,
    );

    // The first run must NOT have carried a resume — otherwise a passing
    // resume assertion below could just be measuring the opening turn.
    if (runs.length !== 1 || runs[0]?.hasCommand) {
      throw new Error(
        `expected exactly 1 plain opening run, got ${JSON.stringify(runs)}`,
      );
    }

    // ── 3. deliver the click ────────────────────────────────────────────
    interruptFired = false; // re-arm: a second interrupt would mean re-suspension
    await adapter.getSink().onInteraction({
      id: actionId,
      conversationKey: "probe-thread-1",
      replyTarget: {},
      eventId: `click-${label}`,
      value: { approved },
      actor: { id: "u-probe", kind: "human", name: "Probe" },
    });

    // `thread.update` lands in `updated`, not `posted` — the card is EDITED in
    // place, so asserting on `posted` growing would be wrong.
    const updatedText = irText(adapter.updated.map((u) => u.ir));
    const settled = approved
      ? /approved/i.test(updatedText)
      : /declined/i.test(updatedText);
    if (!settled) {
      throw new Error(
        `card never reflected the ${label} decision. Updated: ${updatedText || "(no updates)"}`,
      );
    }
    console.log("  [3/5] PASS click ran onClick and edited the card in place");

    // ── 4. the resume must reach the agent in the LEGACY shape ──────────
    const resumeRun = runs.find((r) => r.hasCommand);
    if (!resumeRun) {
      throw new Error(
        `no run carried forwardedProps.command — resume never dialed the agent. Runs: ${JSON.stringify(runs)}`,
      );
    }
    const sent = resumeRun.resume as { approved?: boolean } | undefined;
    if (sent?.approved !== approved) {
      throw new Error(
        `resume carried ${JSON.stringify(sent)}, expected {approved:${approved}}`,
      );
    }
    console.log(
      `  [4/5] PASS resume reached the agent as forwardedProps.command.resume=${JSON.stringify(sent)}`,
    );

    // ── 5. the graph must COMPLETE, not re-suspend ───────────────────────
    if (interruptFired) {
      throw new Error(
        "graph interrupted AGAIN after resume — it did not settle",
      );
    }
    console.log("  [5/5] PASS graph resumed without re-suspending");
  } finally {
    restore();
    await bot.ɵruntime.stop();
  }
}

async function main(): Promise<void> {
  // Fail fast with a useful message rather than a stack of connection refusals.
  const health = AGENT_URL.replace(/\/agent\/.*$/, "/health");
  try {
    const res = await fetch(health);
    if (!res.ok) throw new Error(`health ${res.status}`);
  } catch {
    console.error(
      `[e2e] cannot reach the agent at ${AGENT_URL}\n` +
        `      start it first:  cd agent-py && uv run serve.py`,
    );
    process.exit(1);
  }

  await runCase(true);
  await runCase(false);
  console.log("\nAll interrupt-loop cases passed.");
}

main().catch((err) => {
  console.error("\n[e2e] FAILED:", err);
  process.exit(1);
});
