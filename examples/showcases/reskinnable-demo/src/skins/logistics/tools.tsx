"use client";

import { z } from "zod";
import { useRouter } from "next/navigation";
import {
  useAgentContext,
  useComponent,
  useFrontendTool,
  useHumanInTheLoop,
  ToolCallStatus,
} from "@copilotkit/react-core/v2";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import { useLogistics, notifyDataChanged } from "./actions";
import { usePlannerAuth } from "./components/planner-auth-context";
import {
  ExceptionBoard,
  ShipmentCard,
  LaneTable,
  TradeoffTable,
  InventoryRiskList,
  PlannerPinCard,
  deriveKpiTiles,
  orderExceptionRows,
} from "./components";
import { computeMitigationOptions } from "./data/mitigation-options";
import {
  EXCEPTION_ARGUMENTS,
  SORT_ARGUMENTS,
  STATUS_ARGUMENTS,
  leverChips,
  leverQuery,
  normalizeLevers,
} from "./data/exception-levers";
// NOTE: the escalation-code catalogue is deliberately NOT imported here. See
// data/escalation-codes.ts — beat 6 requires the unlock vocabulary be withheld
// from the agent, and this file is the agent's whole view of the app. The
// `withheldGateVocabulary` rule in eslint.config.mjs fails the build if a
// `*_CODES` / `*_CODE_LABELS` identifier reappears in this file.

/**
 * One trailing note about a list of lanes, or nothing at all when the list is
 * empty. Agrees the verb with the count, because the agent reads these sentences
 * to the room and "SHA-OAK, MTY-HOU is not a lane" is not a sentence anyone
 * should have to say on stage.
 */
const listNote = (
  lanes: string[],
  sentence: (joined: string, plural: boolean) => string,
): string =>
  lanes.length === 0 ? "" : ` ${sentence(lanes.join(", "), lanes.length > 1)}`;

/**
 * Registers everything Meridian Control can do on the client: gen-UI rendered
 * inline in chat, human-in-the-loop confirmations for anything that writes, and
 * agent-context readables so the model always knows the live network state.
 * Renders null — it is a registration host.
 */
export function LogisticsTools() {
  const {
    shipments,
    lanes,
    inventory,
    decisions,
    commitMitigation,
    fileEscalation,
    fileDecision,
    fileRateBrief,
  } = useLogistics();
  const { currentPlanner } = usePlannerAuth();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const router = useRouter();

  const findShipment = (ref: string) =>
    shipments.find((s) => s.id === ref || s.reference === ref);

  // ── Agent-context readables ──────────────────────────────────────────────
  useAgentContext({
    description:
      "The acting planner and their approval authority in USD (null means unlimited).",
    value: JSON.stringify({
      name: currentPlanner.name,
      role: currentPlanner.role,
      region: currentPlanner.region,
      authorityUsd: currentPlanner.authorityUsd,
    }),
  });
  useAgentContext({
    description:
      "Every live shipment: reference, lane, carrier, value, planned vs current ETA, promised date, status, and exception.",
    value: JSON.stringify(shipments),
  });
  useAgentContext({
    description:
      "The network lanes: origin, destination, mode, transit days, on-time reliability, cost per kg, status.",
    value: JSON.stringify(lanes),
  });
  useAgentContext({
    description:
      "Inventory positions with derived days of cover and an at-risk flag.",
    value: JSON.stringify(inventory),
  });
  useAgentContext({
    description:
      "Recent decisions already committed or escalated on the network — the audit trail of what has been done.",
    value: JSON.stringify(decisions),
  });
  // Headline KPIs go over as the TILES, formatted exactly as the Control Tower
  // paints them. This readable used to send the raw `deriveKpis` object, whose
  // `onTimeRate` is a 0.6666… ratio — and the agent duly answered "66.7%" about
  // a screen reading "67%". Sending the display strings closes that
  // structurally, rather than leaving it to a prompt instruction. The raw
  // figures are still reachable: every shipment is in the context above.
  useAgentContext({
    description:
      "Headline KPIs for the network right now, formatted as the Control " +
      "Tower's KPI tiles display them.",
    value: JSON.stringify(deriveKpiTiles(shipments)),
  });
  // NO escalation-code readable. That is beat 6: the agent must learn which code
  // lifts the authority gate by watching the planner file one.

  // ── Gen-UI (rendered inline in chat) ─────────────────────────────────────
  useComponent(
    {
      name: "showExceptions",
      description:
        "Display the exception queue — shipments needing a decision, worst first.",
      // The board renders what it is handed, in the order it is handed; ordering
      // is the caller's job now. See `orderExceptionRows`' header — it used to
      // sort internally, which silently overrode the Control Tower's sort lever.
      render: () => (
        <ExceptionBoard
          shipments={orderExceptionRows(shipments.filter((s) => s.exception))}
          lanes={lanes}
        />
      ),
    },
    [shipments, lanes],
  );

  useComponent(
    {
      name: "showShipment",
      description:
        "Display one shipment as a card. Pass its reference (e.g. 'PO-88213') or id (e.g. 'shp-4821').",
      parameters: z.object({
        shipment: z.string().describe("Shipment reference or id."),
      }),
      render: ({ shipment: ref }) => {
        const shipment = findShipment(ref ?? "");
        if (!shipment) {
          return (
            <div className="rounded-lg border border-dashed border-hairline p-4 text-sm text-ink-muted">
              No shipment matches that reference.
            </div>
          );
        }
        return (
          <ShipmentCard
            shipment={shipment}
            lane={lanes.find((l) => l.id === shipment.laneId)}
          />
        );
      },
    },
    [shipments, lanes],
  );

  useComponent(
    {
      name: "showLane",
      description: "Display lane health across the network.",
      render: () => <LaneTable lanes={lanes} />,
    },
    [lanes],
  );

  useComponent(
    {
      name: "showInventoryRisk",
      description:
        "Display SKUs whose days of cover fall below their safety-stock floor.",
      render: () => <InventoryRiskList items={inventory} />,
    },
    [inventory],
  );

  useComponent(
    {
      name: "compareMitigations",
      description:
        "Display the mitigation trade-off table for one shipment — cost, resulting ETA, whether the promised " +
        "date is met, and risk for each option. ALWAYS call this before recommending an option.",
      parameters: z.object({
        shipment: z.string().describe("Shipment reference or id."),
      }),
      render: ({ shipment: ref }) => {
        const shipment = findShipment(ref ?? "");
        if (!shipment) {
          return (
            <div className="rounded-lg border border-dashed border-hairline p-4 text-sm text-ink-muted">
              No shipment matches that reference.
            </div>
          );
        }
        return (
          <TradeoffTable
            options={computeMitigationOptions(shipment, lanes)}
            authorityUsd={currentPlanner.authorityUsd}
          />
        );
      },
    },
    [shipments, lanes, currentPlanner.authorityUsd],
  );

  // ── BEAT 3c: HITL navigation — confirm the maneuver, THEN move ───────────
  // A plain `navigateTo` does not earn this beat. The room has to see the levers
  // NAMED before anything moves and TINTED on the page afterwards, so the claim
  // "it reached the app's real controls" is something they can check rather than
  // take on faith.
  useHumanInTheLoop(
    {
      name: "showExceptionQueue",
      description:
        "Take the planner to the Control Tower with an exception class, a status filter, a sort order and a " +
        "top-N limit applied. Confirm with them first — the card lists the levers before anything moves. Use " +
        "this for any 'show me the worst / costliest / most delayed exceptions' request. EVERY lever is " +
        "REQUIRED: set the ones the request implies, and pass 'all' (or 0 for the limit) for the ones it does " +
        "not — that is how you say 'leave this lever alone', and it is the only way to say it. Never omit a " +
        "lever, and never fill one merely because the schema offers it: a lever the planner did not ask for " +
        "narrows the board for no reason and claims a choice they never made. The board holds only shipments " +
        "carrying an exception, so a status filter narrows within that queue, and each exception class holds " +
        "only a handful of shipments on this network — setting `exception` narrows it hard. Whatever you set, " +
        "say afterwards how many rows the board is showing out of how many match.",
      // Every lever's advertised values come from the page's OWN control
      // vocabularies (`data/exception-levers`), so this tool cannot offer a
      // value the Control Tower has no control for.
      //
      // REQUIRED, each carrying an explicit "not pulled" value, rather than
      // `.optional()`. See `ANY_LEVER` in `./data/exception-levers` for the
      // measurement behind that: an optional enum gets filled anyway, and the
      // invented pair `exception=PORT_CONGESTION` + `status=on_track` put an
      // EMPTY board on screen. `"all"` and `0` are dropped downstream by
      // `normalizeLevers`, so they draw no chip and set no query param.
      parameters: z.object({
        exception: z
          .enum(EXCEPTION_ARGUMENTS)
          .describe(
            "Restrict to one exception class, or 'all' for every class. Use 'all' unless the planner named a class.",
          ),
        status: z
          .enum(STATUS_ARGUMENTS)
          .describe(
            "Restrict to one shipment status, or 'all' for any status. Use 'all' unless the planner named a status.",
          ),
        sort: z
          .enum(SORT_ARGUMENTS)
          .describe(
            "Row order, or 'all' to keep the board's worst-first default.",
          ),
        top: z
          .number()
          .int()
          .min(0)
          .describe("Limit to the first N rows. Use 0 for no limit."),
      }),
      render: ({ args, status: toolStatus, respond, result }) => {
        // Normalized from ONE record — the same one the URL below is built from,
        // so the view this opens is the view the card just promised. Arguments
        // STREAM, so mid-render a lever that has not arrived yet is simply unset
        // and draws NO chip; a `?? "all"` default would assert a choice the
        // agent never made and then flip when the real value landed.
        const levers = normalizeLevers(args ?? {});
        const chips = leverChips(levers);
        if (toolStatus === ToolCallStatus.Executing && respond) {
          return (
            <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
              <div className="text-sm text-ink">
                {chips.length
                  ? "Open the Control Tower with these controls set?"
                  : "Open the Control Tower?"}
              </div>
              {chips.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <span
                      key={c.label}
                      className="rounded-md bg-brand-soft px-2 py-1 text-xs font-medium text-brand-indigo dark:text-brand-violet"
                    >
                      {c.label}: {c.value}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90"
                  onClick={() => {
                    const query = leverQuery(levers);
                    // The Control Tower IS the skin index, so this is skinHref()
                    // with no segment — `/logistics` unlocked, `/` under a lock.
                    // A hardcoded prefix here fails `pnpm lint`.
                    let navigated = true;
                    try {
                      router.push(`${skinHref()}${query ? `?${query}` : ""}`);
                    } catch (error) {
                      navigated = false;
                      console.error(
                        "[logistics] could not open the Control Tower",
                        error,
                      );
                    }
                    // Respond either way: a throw that escaped this handler would
                    // leave the interrupt unsettled and WEDGE the run, which is
                    // the one outcome worse than not navigating.
                    void respond(
                      navigated
                        ? `Opened the Control Tower${
                            chips.length
                              ? ` with ${chips
                                  .map(
                                    (c) =>
                                      `${c.label.toLowerCase()} ${c.value.toLowerCase()}`,
                                  )
                                  .join(", ")}`
                              : ""
                          }. The controls are highlighted on screen.`
                        : "Could not open the Control Tower — the navigation failed, so the planner is still where they were.",
                    );
                  }}
                >
                  Apply and go
                </button>
                <button
                  type="button"
                  className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted"
                  onClick={() =>
                    void respond("Planner declined the navigation.")
                  }
                >
                  Not now
                </button>
              </div>
            </div>
          );
        }
        // Replay-safe — see commitMitigation's render below.
        return (
          <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
            {result ? String(result) : "Preparing the view…"}
          </div>
        );
      },
    },
    [router, skinHref],
  );

  // ── HITL: commit a mitigation (confirm before writing) ───────────────────
  useHumanInTheLoop(
    {
      name: "commitMitigation",
      description:
        "Ask the planner to confirm committing a mitigation for a shipment. Pass the shipment reference and the " +
        "kind you recommend. The server recomputes the cost and may REJECT it as over the planner's approval " +
        "authority — report that honestly and offer to file an escalation. Never claim success without confirmation.",
      parameters: z.object({
        shipment: z
          .string()
          .describe("Shipment reference or id, e.g. 'PO-88213'."),
        kind: z
          .enum(["expedite", "reroute", "split", "absorb"])
          .describe("Which mitigation to commit."),
        rationale: z
          .string()
          .describe("One short sentence on why this option."),
      }),
      render: ({ args, status, respond, result }) => {
        const kind = args?.kind ?? "absorb";
        const ref = args?.shipment ?? "";
        if (status === ToolCallStatus.Executing && respond) {
          return (
            <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
              <div className="text-sm text-ink">
                Commit <span className="font-semibold text-brand">{kind}</span>{" "}
                on <span className="font-mono font-semibold">{ref}</span>?
              </div>
              <div className="text-xs text-ink-muted">{args?.rationale}</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90"
                  onClick={async () => {
                    const shipment = findShipment(ref);
                    if (!shipment)
                      return void respond(
                        "No shipment matches that reference.",
                      );
                    // Named `outcome`, not `result`: the render's own `result`
                    // prop (the recorded tool result) is in scope here and is
                    // what the terminal branch below reads.
                    const outcome = await commitMitigation({
                      shipmentId: shipment.id,
                      kind,
                      rationale: args?.rationale ?? "",
                    });
                    void respond(
                      outcome.ok
                        ? `Committed ${kind} on ${ref} at $${outcome.option?.costUsd.toLocaleString("en-US")}.`
                        : // Surface the server's block verbatim so the agent learns it
                          // instead of reporting a false success.
                          `REJECTED: ${outcome.error}`,
                    );
                  }}
                >
                  Commit {kind}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted"
                  onClick={() =>
                    void respond("Planner declined this mitigation.")
                  }
                >
                  Not this one
                </button>
              </div>
            </div>
          );
        }
        // Replay-safe: on a reopened thread the recorded `result` is handed back
        // but no status transition ever fires, so keying the terminal copy off
        // `status` would render "Preparing…" forever. `result` is the only thing
        // that survives a reload — and it carries the real outcome sentence the
        // planner's click produced, so the replayed card reads better too.
        return (
          <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
            {result ? String(result) : "Preparing the decision…"}
          </div>
        );
      },
    },
    [shipments, commitMitigation],
  );

  // ══ BEAT 3a — DRIVE THE APP, SECRET WITHHELD ═════════════════════════════
  // The agent fires this; the PLANNER types their PIN into the card; the card
  // POSTs it straight to REST. `respond()` gets a confirmation sentence and the
  // digits appear nowhere in the AG-UI stream — which is what the beat is graded
  // on, in the inspector, live.
  useHumanInTheLoop(
    {
      name: "authorizeWithPlannerPin",
      description:
        "Release a mitigation the planner is authorized to make, confirmed with their PIN. " +
        "This is a SECOND FACTOR, not an authority override — a cost above their authority still " +
        "needs an escalation. Fire this IMMEDIATELY when the planner asks to release or authorize " +
        "a cost — the planner enters their PIN in the card themselves. Never ask for the PIN and " +
        "never ask which shipment first if the context makes it clear.",
      parameters: z.object({
        shipment: z.string().describe("Shipment reference or id."),
      }),
      // NOTE there is deliberately NO `kind` parameter. The card picks the
      // option itself (below), so the agent cannot name an over-authority one
      // and turn a second factor into an unlock.
      render: ({ args, status: toolStatus, respond, result }) => {
        const ref = args?.shipment ?? "";
        if (toolStatus === ToolCallStatus.Executing && respond) {
          const shipment = findShipment(ref);
          if (!shipment) {
            return (
              <div className="rounded-lg border border-hairline bg-surface p-4 text-sm text-negative">
                No shipment matches that reference.
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={() => void respond("No such shipment.")}
                >
                  Dismiss
                </button>
              </div>
            );
          }
          // The cost is the MITIGATION's, never the shipment's value. It comes
          // from computeMitigationOptions — the same helper compareMitigations
          // renders — so the figure on the card is the figure the server will
          // recompute and check against the planner's authority.
          //
          // The cheapest option the planner may ALREADY commit, and `> 0`
          // because `absorb` always costs $0: a PIN releasing nothing is not an
          // authorization, it is a formality. The PIN is a second factor on the
          // planner's own authority, never an override of it, so an
          // over-authority option is deliberately NOT offered here — that path
          // is beat 6's escalation, and if a PIN could take it the escalation
          // gate would have a second door and the teach arc would never fire.
          const cap = currentPlanner.authorityUsd;
          const option = computeMitigationOptions(shipment, lanes)
            .filter((o) => o.costUsd > 0 && (cap === null || o.costUsd <= cap))
            .sort((a, b) => a.costUsd - b.costUsd)[0];
          if (!option) {
            return (
              <div className="rounded-lg border border-hairline bg-surface p-4 text-sm text-negative">
                Nothing on {shipment.reference} is within your approval
                authority — this one needs an escalation, not a PIN.
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={() =>
                    void respond(
                      "No mitigation on that shipment is within the planner's authority; it needs an escalation.",
                    )
                  }
                >
                  Dismiss
                </button>
              </div>
            );
          }
          return (
            <PlannerPinCard
              shipmentReference={shipment.reference}
              kind={option.kind}
              costUsd={option.costUsd}
              plannerId={currentPlanner.id}
              onAuthorized={(message) => {
                // The card writes through its own fetch, so this bus is what
                // makes the board and the Decision Log catch up.
                notifyDataChanged();
                void respond(message);
              }}
              onDeclined={() => void respond("Planner declined to authorize.")}
            />
          );
        }
        // Replay-safe — see commitMitigation's render below.
        return (
          <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
            {result ? String(result) : "Preparing the authorization…"}
          </div>
        );
      },
    },
    [shipments, lanes, currentPlanner],
  );

  // ── HITL: file an escalation (the recovery path from an authority block) ──
  useHumanInTheLoop(
    {
      name: "fileEscalation",
      description:
        "File an escalation so an over-authority mitigation can proceed. Pass the shipment and the escalation " +
        "code to file under. You do NOT hold the list of codes and must not guess one: use the exact code the " +
        "planner used, or ask them which code applies. Filing does not guarantee the mitigation clears.",
      parameters: z.object({
        shipment: z.string().describe("Shipment reference or id."),
        code: z
          .string()
          .describe(
            "The escalation code to file under. You are NOT given the catalogue — " +
              "use the exact code the planner demonstrated, or ask them which code applies.",
          ),
        rationale: z
          .string()
          .describe("One short sentence justifying the escalation."),
      }),
      render: ({ args, status, respond, result }) => {
        const ref = args?.shipment ?? "";
        const code = args?.code ?? "";
        if (status === ToolCallStatus.Executing && respond) {
          return (
            <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
              <div className="text-sm text-ink">
                File escalation{" "}
                <span className="font-mono font-semibold text-brand">
                  {code}
                </span>{" "}
                on <span className="font-mono font-semibold">{ref}</span>?
              </div>
              <div className="text-xs text-ink-muted">{args?.rationale}</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90"
                  onClick={async () => {
                    const shipment = findShipment(ref);
                    if (!shipment)
                      return void respond(
                        "No shipment matches that reference.",
                      );
                    // Named `outcome` — see commitMitigation above; `result` is
                    // the render's recorded-result prop.
                    const outcome = await fileEscalation({
                      shipmentId: shipment.id,
                      code,
                      rationale: args?.rationale ?? "",
                    });
                    void respond(
                      outcome.ok
                        ? `Escalation ${code} approved on ${ref}. Re-attempt the mitigation to see whether it now clears.`
                        : `REJECTED: ${outcome.error}`,
                    );
                  }}
                >
                  File it
                </button>
                <button
                  type="button"
                  className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted"
                  onClick={() => void respond("Planner declined to escalate.")}
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        }
        // Replay-safe — see commitMitigation's render above.
        return (
          <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
            {result ? String(result) : "Preparing the escalation…"}
          </div>
        );
      },
    },
    [shipments, fileEscalation],
  );

  // ── Frontend tool: file a durable decision record ────────────────────────
  // Logs a decision the agent did NOT execute through commitMitigation (a
  // verbally-accepted recommendation, an escalation outcome). Registered here so
  // it works from any page. The server derives decidedBy/role from the planner
  // and ignores any client cost — so we file at 0 and let the server own trust.
  useFrontendTool(
    {
      name: "createDecisionRecord",
      description:
        "File a durable decision record in the Decision Log for a decision NOT already committed through " +
        "commitMitigation — e.g. a recommendation the planner accepted verbally, or an escalation outcome. Pass " +
        "the shipment reference and a one-sentence rationale.",
      parameters: z.object({
        shipment: z
          .string()
          .describe("Shipment reference or id, e.g. 'PO-88213'."),
        kind: z
          .enum(["expedite", "reroute", "split", "absorb", "escalation"])
          .describe("What was decided."),
        rationale: z.string().describe("One short sentence on why."),
        costUsd: z
          .number()
          .optional()
          .describe(
            "The cost if known. The server does not trust this and files the record at 0.",
          ),
      }),
      handler: async ({ shipment: ref, kind, rationale }) => {
        const shipment = findShipment(ref ?? "");
        if (!shipment)
          return "No shipment matches that reference; nothing was filed.";
        const result = await fileDecision({
          shipmentId: shipment.id,
          kind: kind ?? "absorb",
          costUsd: 0,
          rationale: rationale ?? "",
        });
        return result.ok
          ? `Filed ${kind} on ${ref} to the Decision Log.`
          : `REJECTED: ${result.error}`;
      },
      // Replay-safe — see commitMitigation's render above. This tool has no
      // `respond`, so `result` is the handler's own return sentence.
      render: ({ result }) => (
        <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
          {result ? String(result) : "Filing to the decision log…"}
        </div>
      ),
    },
    [shipments, fileDecision],
  );

  // ══ BEAT 3d — MULTIMODAL IN, DURABLE ARTIFACT OUT ════════════════════════
  // The planner attaches a carrier rate sheet; the agent reads it and files the
  // rates it found into a record that belongs to the APP. Delete the whole
  // thread and the brief is still on the Decision Log — which is the entire
  // claim, and the reason this is a stored `RateBrief` rather than the canvas
  // brief `renderBrief` paints (that one dies with the thread).
  useFrontendTool(
    {
      name: "fileRateBrief",
      description:
        "File a durable rate brief from a carrier rate sheet the planner has ATTACHED. Read the document and " +
        "carry its REAL figures across — the per-lane rates it lists, its effective date, and the lanes it " +
        "quotes — rather than re-deriving them from the network context you already have. If the sheet quotes a " +
        "lane the network does not carry, include it: leave `oldRateUsdPerKg` unset for it, because there is no " +
        "prior rate on file. Never state a rate the document does not list.",
      parameters: z.object({
        carrier: z.string().describe("The carrier whose sheet was attached."),
        effective: z
          .string()
          .describe(
            "The effective date exactly as the sheet states it. If the sheet does not state one, say so rather than guessing.",
          ),
        summary: z
          .string()
          .describe(
            "Two sentences on what the sheet changes and why it matters.",
          ),
        laneRates: z
          .array(
            z.object({
              lane: z
                .string()
                .describe('Lane code as the sheet prints it, e.g. "SHA-LAX".'),
              mode: z.string().describe("Mode as the sheet prints it."),
              oldRateUsdPerKg: z
                .number()
                .optional()
                .describe(
                  "The rate on file today, per kg. OMIT for a lane the sheet introduces — never send 0.",
                ),
              newRateUsdPerKg: z
                .number()
                .describe("The quoted forward rate, per kg."),
            }),
          )
          .describe("The rates the DOCUMENT lists, one row per lane."),
        // The row caps are deliberately not repeated here: they are a layout
        // budget owned by `POST /briefs`, which names the limit in its refusal,
        // and a second copy of the number is a second thing to drift.
        impacts: z
          .array(z.string())
          .describe(
            "At most three short consequences for the network, each derived from the rates above.",
          ),
      }),
      handler: async ({ carrier, effective, summary, laneRates, impacts }) => {
        const outcome = await fileRateBrief({
          carrier: carrier ?? "",
          effective: effective ?? "",
          summary: summary ?? "",
          laneRates: laneRates ?? [],
          impacts: impacts ?? [],
        });
        if (outcome.ok) {
          // The server SETTLES every prior rate against the carrier's own lanes,
          // so the two notes below are the only ways the filed record can differ
          // from what was sent. Say them, so the transcript and the artifact
          // agree — the alternative is the agent narrating a movement the record
          // does not hold. Both are written for one OR many lanes: these
          // sentences are read aloud, and "SHA-OAK, MTY-HOU is not a lane" is a
          // sentence nobody should have to say on stage.
          return (
            `Filed the ${carrier} rate brief. It is on the Decision Log under ` +
            `"Rate briefs on file", and it stays there whatever happens to this thread.` +
            listNote(
              outcome.noPriorRateOnFile,
              (lanes, plural) =>
                `${lanes} ${plural ? "are" : "is"} not a lane this carrier serves, so ${
                  plural ? "they were" : "it was"
                } filed with no prior rate — report as new service, not as a change.`,
            ) +
            listNote(
              outcome.ambiguousLanes,
              (lanes, plural) =>
                `${lanes} ${plural ? "match" : "matches"} more than one lane at that mode, so the prior ${plural ? "rates" : "rate"} you read could not be checked — say the comparison is unverified.`,
            )
          );
        }
        // Surface the route's own message: it refuses a brief that would not fit
        // the card or whose rows it cannot read, and names the offending field —
        // which is only actionable if the agent can see it.
        return `REJECTED: ${outcome.error}`;
      },
      // Replay-safe — see commitMitigation's render above. This tool has no
      // `respond`, so `result` is the handler's own return sentence.
      render: ({ result }) => (
        <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
          {result ? String(result) : "Filing the rate brief…"}
        </div>
      ),
    },
    [fileRateBrief],
  );

  return null;
}

export default LogisticsTools;
