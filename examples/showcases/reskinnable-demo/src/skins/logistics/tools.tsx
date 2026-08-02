"use client";

import { z } from "zod";
import {
  useAgentContext,
  useComponent,
  useFrontendTool,
  useHumanInTheLoop,
  ToolCallStatus,
} from "@copilotkit/react-core/v2";
import { useLogistics } from "./actions";
import { usePlannerAuth } from "./components/planner-auth-context";
import {
  ExceptionBoard,
  ShipmentCard,
  LaneTable,
  TradeoffTable,
  InventoryRiskList,
  deriveKpis,
} from "./components";
import { computeMitigationOptions } from "./data/mitigation-options";
import {
  ESCALATION_CODES,
  ESCALATION_CODE_LABELS,
} from "./data/escalation-codes";
import {
  renderBriefParams,
  buildBriefOps,
  A2UI_OPERATIONS_KEY,
} from "./build-brief-ops";

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
  } = useLogistics();
  const { currentPlanner } = usePlannerAuth();

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
  useAgentContext({
    description: "Headline KPIs for the network right now.",
    value: JSON.stringify(deriveKpis(shipments)),
  });
  useAgentContext({
    description:
      "Valid escalation codes. Only these are accepted when filing an escalation.",
    value: JSON.stringify(ESCALATION_CODE_LABELS),
  });

  // ── Gen-UI (rendered inline in chat) ─────────────────────────────────────
  useComponent({
    name: "showExceptions",
    description:
      "Display the exception queue — shipments needing a decision, worst first.",
    render: () => <ExceptionBoard shipments={shipments} lanes={lanes} />,
  });

  useComponent({
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
  });

  useComponent({
    name: "showLane",
    description: "Display lane health across the network.",
    render: () => <LaneTable lanes={lanes} />,
  });

  useComponent({
    name: "showInventoryRisk",
    description:
      "Display SKUs whose days of cover fall below their safety-stock floor.",
    render: () => <InventoryRiskList items={inventory} />,
  });

  useComponent({
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
  });

  // ── HITL: commit a mitigation (confirm before writing) ───────────────────
  useHumanInTheLoop({
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
      rationale: z.string().describe("One short sentence on why this option."),
    }),
    render: ({ args, status, respond }) => {
      const kind = args?.kind ?? "absorb";
      const ref = args?.shipment ?? "";
      if (status === ToolCallStatus.Executing && respond) {
        return (
          <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
            <div className="text-sm text-ink">
              Commit <span className="font-semibold text-brand">{kind}</span> on{" "}
              <span className="font-mono font-semibold">{ref}</span>?
            </div>
            <div className="text-xs text-ink-muted">{args?.rationale}</div>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90"
                onClick={async () => {
                  const shipment = findShipment(ref);
                  if (!shipment)
                    return void respond("No shipment matches that reference.");
                  const result = await commitMitigation({
                    shipmentId: shipment.id,
                    kind,
                    rationale: args?.rationale ?? "",
                  });
                  void respond(
                    result.ok
                      ? `Committed ${kind} on ${ref} at $${result.option?.costUsd.toLocaleString("en-US")}.`
                      : // Surface the server's block verbatim so the agent learns it
                        // instead of reporting a false success.
                        `REJECTED: ${result.error}`,
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
      return (
        <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
          {status === ToolCallStatus.Complete
            ? `Mitigation on ${ref} handled.`
            : "Preparing the decision…"}
        </div>
      );
    },
  });

  // ── HITL: file an escalation (the recovery path from an authority block) ──
  useHumanInTheLoop({
    name: "fileEscalation",
    description:
      "File an escalation so an over-authority mitigation can proceed. Pass the shipment and a code from the " +
      "valid escalation-code catalogue in your context. Only some codes actually authorize the spend; an " +
      "invalid code is rejected.",
    parameters: z.object({
      shipment: z.string().describe("Shipment reference or id."),
      code: z
        .enum(ESCALATION_CODES)
        .describe("An escalation code from the catalogue."),
      rationale: z
        .string()
        .describe("One short sentence justifying the escalation."),
    }),
    render: ({ args, status, respond }) => {
      const ref = args?.shipment ?? "";
      const code = args?.code ?? "";
      if (status === ToolCallStatus.Executing && respond) {
        return (
          <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
            <div className="text-sm text-ink">
              File escalation{" "}
              <span className="font-mono font-semibold text-brand">{code}</span>{" "}
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
                    return void respond("No shipment matches that reference.");
                  const result = await fileEscalation({
                    shipmentId: shipment.id,
                    code,
                    rationale: args?.rationale ?? "",
                  });
                  void respond(
                    result.ok
                      ? `Escalation ${code} approved on ${ref}. Re-attempt the mitigation to see whether it now clears.`
                      : `REJECTED: ${result.error}`,
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
      return (
        <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
          {status === ToolCallStatus.Complete
            ? "Escalation handled."
            : "Preparing the escalation…"}
        </div>
      );
    },
  });

  // ── Frontend tool: render the decision brief on the canvas ───────────────
  useFrontendTool({
    name: "renderBrief",
    description:
      "Build a decision brief on the canvas. Pick which KPIs, charts, and tables to show; the figures bind to " +
      "live data on the client, so supply selections and LABEL-ONLY text — never numbers.",
    parameters: renderBriefParams,
    handler: async (spec) => ({ [A2UI_OPERATIONS_KEY]: buildBriefOps(spec) }),
    render: ({ status }) => (
      <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
        {status === ToolCallStatus.Complete
          ? "Decision brief is on the canvas."
          : "Building the decision brief…"}
      </div>
    ),
  });

  return null;
}

export default LogisticsTools;
