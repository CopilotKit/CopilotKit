import seed from "./seed.json";
import type {
  CarrierNotice,
  Decision,
  Escalation,
  InventoryItem,
  InventoryRisk,
  Lane,
  Planner,
  RateBrief,
  Shipment,
  ShipmentNote,
} from "./types";
import { isValidEscalationCode } from "./escalation-codes";
import { isCarrierMessage, isWatchReason, markNote } from "./handling";

/**
 * In-memory, file-seeded store for the Meridian control tower.
 * Seeded once at module init and deep-cloned so mutations never bleed back
 * into the imported JSON. All mutations live for the server process only;
 * restarting the dev server resets to seed. Intentional demo behavior.
 */
type SeededDB = {
  lanes: Lane[];
  shipments: Shipment[];
  inventory: InventoryItem[];
  planners: Planner[];
  escalations: Escalation[];
  decisions: Decision[];
};

/**
 * `rateBriefs` is split out of `SeededDB` because `seed.json` has no key for it
 * and never will: a rate brief only exists once a document has been ingested, so
 * a seeded one would be an artifact with no document behind it — precisely the
 * thing beat 3d exists to disprove. Keeping it off the seed type also means
 * `structuredClone(seed)` cannot silently leave it `undefined`.
 */
type DB = SeededDB & { rateBriefs: RateBrief[] };

const db: DB = { ...(structuredClone(seed) as SeededDB), rateBriefs: [] };

let idCounter = 0;
const nextId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${idCounter++}`;

export const reset = (): void => {
  const fresh = structuredClone(seed) as SeededDB;
  db.lanes = fresh.lanes;
  db.shipments = fresh.shipments;
  db.inventory = fresh.inventory;
  db.planners = fresh.planners;
  db.escalations = [];
  db.decisions = [];
  // Beat 3d's artifact is wiped too. A presenter reset that left last run's rate
  // brief on the Decision Log would open the demo with an artifact whose
  // document was never ingested in front of this audience.
  db.rateBriefs = [];
  // Beat 5's three writes need no line of their own: `watch`, `carrierNotices`
  // and `notes` all live ON the shipment and `seed.json` carries none of them,
  // so re-cloning the seed above already drops every one. Said out loud because
  // the opposite is the demo-destroying half — a board that opens with last
  // run's 🚨 note already on PO-88251 makes the stored procedure look like it
  // ran before anyone asked.
  idCounter = 0;
};

// ---- Reads --------------------------------------------------------------
export const lanes = (): Lane[] => db.lanes;
export const shipments = (): Shipment[] => db.shipments;
export const inventory = (): InventoryItem[] => db.inventory;
export const planners = (): Planner[] => db.planners;
export const escalations = (): Escalation[] => db.escalations;
export const decisions = (): Decision[] => db.decisions;
export const rateBriefs = (): RateBrief[] => db.rateBriefs;

export const findLane = (id: string): Lane | undefined =>
  db.lanes.find((l) => l.id === id);
export const findShipment = (id: string): Shipment | undefined =>
  db.shipments.find((s) => s.id === id);
export const findPlanner = (id: string): Planner | undefined =>
  db.planners.find((p) => p.id === id);
export const findEscalation = (id: string): Escalation | undefined =>
  db.escalations.find((e) => e.id === id);

/**
 * A carrier name reduced to what actually identifies it.
 *
 * Every caller of the three functions below receives this name from a MODEL that
 * read it off a PDF whose masthead is `carrier.toUpperCase()` — so
 * "PACIFIC STAR LINE" and "Pacific  Star Line" are the same carrier, and an
 * exact `===` would call both of them strangers. That is not a cosmetic miss:
 * `POST /briefs` settles every prior rate against this lookup, so a carrier that
 * fails to match silently turns EVERY lane into "no rate on file" and has the
 * agent announce that lanes the network has carried for years are new service.
 */
const canonicalCarrier = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLowerCase();

/** Every carrier the network actually moves freight with, sorted. */
export const carriersOnFile = (): string[] =>
  [...new Set(db.shipments.map((s) => s.carrier))].sort();

/**
 * The network's OWN spelling of a carrier, or `undefined` when it moves nothing
 * here. Callers store this rather than what they were handed, so an artifact
 * filed from a shouting PDF masthead is still titled "Pacific Star Line".
 */
export const findCarrier = (name: string): string | undefined => {
  const key = canonicalCarrier(name);
  return db.shipments.find((s) => canonicalCarrier(s.carrier) === key)?.carrier;
};

/**
 * The lanes one carrier actually moves freight on, deduped, in network order.
 *
 * DERIVED, because the seed models the carrier as a property of a SHIPMENT: a
 * lane can be served by more than one carrier (SHA-LAX ocean is moved by both
 * Pacific Star Line and Blue Meridian), which is exactly the shape a per-carrier
 * rate sheet asks about.
 *
 * Lives here rather than in either route because BOTH beat-3d routes need the
 * same answer and must not drift: `GET /rate-sheet` builds the document from it,
 * and `POST /briefs` settles the prior rates in the filed brief against it. Two
 * copies of this filter would be two different opinions about what a carrier
 * serves, and the document and the artifact would disagree.
 */
export const lanesServedBy = (carrier: string): Lane[] => {
  const key = canonicalCarrier(carrier);
  const laneIds = new Set(
    db.shipments
      .filter((s) => canonicalCarrier(s.carrier) === key)
      .map((s) => s.laneId),
  );
  return db.lanes.filter((lane) => laneIds.has(lane.id));
};

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

/**
 * BEAT 5, step 1 — raise the tower's watch flag on a shipment.
 *
 * Throws code-like Errors the calling route maps to HTTP status, in the same
 * shape as `openEscalation`. `INVALID_WATCH_REASON` is a CLOSED set on purpose,
 * and it is closed for the opposite reason to the escalation catalogue: the
 * agent is GIVEN this vocabulary (see `handling.ts`), so a value outside it is a
 * model error worth surfacing rather than a discovery to be protected.
 */
export const raiseWatch = (
  shipmentId: string,
  reason: string,
  raisedBy: string,
): Shipment => {
  const shipment = findShipment(shipmentId);
  if (!shipment) throw new Error("NOT_FOUND");
  if (!isWatchReason(reason)) throw new Error("INVALID_WATCH_REASON");
  shipment.watch = {
    reason,
    since: new Date().toISOString(),
    raisedBy,
  };
  return shipment;
};

/** BEAT 5, step 2 — record a templated message sent to the shipment's carrier. */
export const sendCarrierNotice = (
  shipmentId: string,
  template: string,
  sentBy: string,
): CarrierNotice => {
  const shipment = findShipment(shipmentId);
  if (!shipment) throw new Error("NOT_FOUND");
  if (!isCarrierMessage(template)) throw new Error("INVALID_CARRIER_MESSAGE");
  const notice: CarrierNotice = {
    id: nextId("cn"),
    template,
    // Copied off the SHIPMENT, never taken from the caller: the carrier on the
    // notice has to be the carrier the freight is actually with, and a
    // client-supplied name is a name the model spelled.
    carrier: shipment.carrier,
    sentBy,
    createdAt: new Date().toISOString(),
  };
  shipment.carrierNotices = [notice, ...(shipment.carrierNotices ?? [])];
  return notice;
};

/**
 * BEAT 5, step 3 — post a short note on the shipment record.
 *
 * The marker is forced by `markNote`, not requested from the caller: the point
 * of the note is that the room can SEE the record changed from the back of the
 * room, and a model that phrases it plainly would silently cost the beat its
 * only visible artifact on the board.
 */
export const addShipmentNote = (
  shipmentId: string,
  text: string,
  author: string,
): ShipmentNote => {
  const shipment = findShipment(shipmentId);
  if (!shipment) throw new Error("NOT_FOUND");
  if (!text.trim()) throw new Error("EMPTY_NOTE");
  const note: ShipmentNote = {
    id: nextId("nt"),
    text: markNote(text),
    author,
    createdAt: new Date().toISOString(),
  };
  shipment.notes = [note, ...(shipment.notes ?? [])];
  return note;
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
 * BEAT 3d — file the durable rate brief. Newest first, like the decision log.
 *
 * Nothing here references a thread, a run or a message: the record belongs to
 * the application, which is the entire claim the beat makes on stage.
 */
export const fileRateBrief = (
  brief: Omit<RateBrief, "id" | "createdAt">,
): RateBrief => {
  const filed: RateBrief = {
    ...brief,
    id: nextId("rb"),
    createdAt: new Date().toISOString(),
  };
  db.rateBriefs.unshift(filed);
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
