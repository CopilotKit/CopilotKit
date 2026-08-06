import seed from "./seed.json";
import type {
  Decision,
  Escalation,
  InventoryItem,
  InventoryRisk,
  Lane,
  Planner,
  Shipment,
} from "./types";
import { isValidEscalationCode } from "./escalation-codes";

/**
 * In-memory, file-seeded store for the Meridian control tower.
 * Seeded once at module init and deep-cloned so mutations never bleed back
 * into the imported JSON. All mutations live for the server process only;
 * restarting the dev server resets to seed. Intentional demo behavior.
 */
type DB = {
  lanes: Lane[];
  shipments: Shipment[];
  inventory: InventoryItem[];
  planners: Planner[];
  escalations: Escalation[];
  decisions: Decision[];
};

const db: DB = structuredClone(seed) as DB;

let idCounter = 0;
const nextId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${idCounter++}`;

export const reset = (): void => {
  const fresh = structuredClone(seed) as DB;
  db.lanes = fresh.lanes;
  db.shipments = fresh.shipments;
  db.inventory = fresh.inventory;
  db.planners = fresh.planners;
  db.escalations = [];
  db.decisions = [];
  idCounter = 0;
};

// ---- Reads --------------------------------------------------------------
export const lanes = (): Lane[] => db.lanes;
export const shipments = (): Shipment[] => db.shipments;
export const inventory = (): InventoryItem[] => db.inventory;
export const planners = (): Planner[] => db.planners;
export const escalations = (): Escalation[] => db.escalations;
export const decisions = (): Decision[] => db.decisions;

export const findLane = (id: string): Lane | undefined =>
  db.lanes.find((l) => l.id === id);
export const findShipment = (id: string): Shipment | undefined =>
  db.shipments.find((s) => s.id === id);
export const findPlanner = (id: string): Planner | undefined =>
  db.planners.find((p) => p.id === id);
export const findEscalation = (id: string): Escalation | undefined =>
  db.escalations.find((e) => e.id === id);

/**
 * Days of cover is DERIVED, never stored: on-hand divided by daily demand.
 * A SKU is at risk when its cover is below its safety-stock floor.
 */
export const inventoryRisk = (): InventoryRisk[] =>
  db.inventory.map((item) => {
    const daysOfCover =
      item.dailyDemand > 0
        ? Math.floor(item.onHandUnits / item.dailyDemand)
        : Infinity;
    return { ...item, daysOfCover, atRisk: daysOfCover < item.safetyStockDays };
  });

// ---- Mutations ----------------------------------------------------------
export const updateShipment = (
  id: string,
  patch: Partial<Shipment>,
): Shipment | undefined => {
  const idx = db.shipments.findIndex((s) => s.id === id);
  if (idx === -1) return undefined;
  db.shipments[idx] = { ...db.shipments[idx], ...patch };
  return db.shipments[idx];
};

/** File a decision; newest first so the Decision Log leads with it. */
export const addDecision = (
  decision: Omit<Decision, "id" | "createdAt">,
): Decision => {
  const filed: Decision = {
    ...decision,
    id: nextId("dec"),
    createdAt: new Date().toISOString(),
  };
  db.decisions.unshift(filed);
  return filed;
};

/**
 * Open a DRAFT escalation. Throws code-like Errors (`NOT_FOUND`,
 * `INVALID_ESCALATION_CODE`) that the calling route maps to HTTP status.
 * The closed code catalogue forces the agent to learn valid codes rather
 * than invent plausible-looking strings.
 */
export const openEscalation = (
  shipmentId: string,
  code: string,
  rationale: string,
): Escalation => {
  if (!findShipment(shipmentId)) throw new Error("NOT_FOUND");
  if (!isValidEscalationCode(code)) throw new Error("INVALID_ESCALATION_CODE");
  const escalation: Escalation = {
    id: nextId("esc"),
    shipmentId,
    code,
    status: "draft",
    rationale,
    createdAt: new Date().toISOString(),
  };
  db.escalations.push(escalation);
  return escalation;
};

/**
 * Approve a draft escalation (auto-approve; no review step in the demo) and
 * link it to its shipment's `activeEscalationId` — which is what lifts the
 * authority gate, PROVIDED the code is justifying (see authority.ts).
 */
export const approveEscalation = (escalationId: string): Escalation => {
  const esc = findEscalation(escalationId);
  if (!esc) throw new Error("NOT_FOUND");
  if (esc.status !== "draft") throw new Error("ALREADY_APPROVED");
  esc.status = "approved";
  updateShipment(esc.shipmentId, { activeEscalationId: esc.id });
  return esc;
};
