import { createHash, randomUUID } from "node:crypto";
import { db, getOrder } from "./db";
import type { Order, OrderStatus, Role, ServiceLevel, SessionUser } from "./db";

export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface OrderInput {
  customer: string;
  origin: string;
  destination: string;
  shipDate: string;
  serviceLevel: ServiceLevel;
  assignedUserId: string | null;
  status: OrderStatus;
  notes: string;
}

function requireRole(actor: SessionUser, allowed: Role[]) {
  if (!allowed.includes(actor.role))
    throw new DomainError("Your role cannot make this change", 403);
}

function nonempty(value: string, label: string, max = 160) {
  const normalized = value.trim();
  if (!normalized || normalized.length > max)
    throw new DomainError(`${label} must be 1–${max} characters`);
  return normalized;
}

function validDate(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new DomainError("Enter a valid ship date");
  return value;
}

function validateOrder(actor: SessionUser, input: OrderInput): OrderInput {
  const serviceLevels = ["standard", "express", "priority"];
  const statuses = ["draft", "booked", "in_transit", "delivered", "cancelled"];
  if (!serviceLevels.includes(input.serviceLevel))
    throw new DomainError("Invalid service level");
  if (!statuses.includes(input.status)) throw new DomainError("Invalid status");
  if (input.assignedUserId) {
    const assigned = db()
      .prepare(
        "SELECT id FROM users WHERE id = ? AND organization_id = ? AND active = 1",
      )
      .get(input.assignedUserId, actor.organizationId);
    if (!assigned)
      throw new DomainError(
        "Assigned operator is unavailable in this organization",
      );
  }
  if (input.notes.length > 2000)
    throw new DomainError("Notes must be 2000 characters or less");
  return {
    customer: nonempty(input.customer, "Customer"),
    origin: nonempty(input.origin, "Origin"),
    destination: nonempty(input.destination, "Destination"),
    shipDate: validDate(input.shipDate),
    serviceLevel: input.serviceLevel,
    assignedUserId: input.assignedUserId || null,
    status: input.status,
    notes: input.notes.trim(),
  };
}

const transitions: Record<OrderStatus, OrderStatus[]> = {
  draft: ["draft", "booked", "cancelled"],
  booked: ["booked", "in_transit", "cancelled"],
  in_transit: ["in_transit", "delivered"],
  delivered: ["delivered"],
  cancelled: ["cancelled"],
};

function transaction<T>(fn: () => T): T {
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function operation<T>(
  actor: SessionUser,
  key: string,
  action: string,
  payload: unknown,
  entityType: string,
  mutate: () => { id: string; result: T },
): T {
  if (!/^[a-f0-9-]{36}$/.test(key))
    throw new DomainError("Invalid operation key");
  const hash = createHash("sha256")
    .update(JSON.stringify({ action, payload }))
    .digest("hex");
  return transaction(() => {
    const prior = db()
      .prepare(
        "SELECT organization_id, actor_user_id, action, payload_hash, outcome FROM operations WHERE operation_key = ?",
      )
      .get(key) as
      | {
          organization_id: string;
          actor_user_id: string;
          action: string;
          payload_hash: string;
          outcome: string;
        }
      | undefined;
    if (prior) {
      if (
        prior.organization_id !== actor.organizationId ||
        prior.actor_user_id !== actor.id ||
        prior.action !== action ||
        prior.payload_hash !== hash
      )
        throw new DomainError(
          "Operation key was already used for another change",
          409,
        );
      return JSON.parse(prior.outcome) as T;
    }
    const { id, result } = mutate();
    db()
      .prepare(
        "INSERT INTO operations(operation_key, organization_id, actor_user_id, entity_type, entity_id, action, payload_hash, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        key,
        actor.organizationId,
        actor.id,
        entityType,
        id,
        action,
        hash,
        JSON.stringify(result),
        new Date().toISOString(),
      );
    return result;
  });
}

export function createOrder(
  actor: SessionUser,
  input: OrderInput,
  key: string,
): { id: string; reference: string } {
  requireRole(actor, ["admin", "operator"]);
  return operation(actor, key, "create_order", input, "order", () => {
    const value = validateOrder(actor, input);
    if (value.status !== "draft" && value.status !== "booked")
      throw new DomainError("New orders start as draft or booked");
    const id = randomUUID();
    const reference = `NS-${randomUUID().slice(0, 8).toUpperCase()}`;
    const now = new Date().toISOString();
    db()
      .prepare(`INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 1, ?, ?)`)
      .run(
        id,
        actor.organizationId,
        reference,
        value.customer,
        value.origin,
        value.destination,
        value.shipDate,
        value.serviceLevel,
        value.assignedUserId,
        value.status,
        value.notes,
        now,
        now,
      );
    return { id, result: { id, reference } };
  });
}

export function updateOrder(
  actor: SessionUser,
  id: string,
  version: number,
  input: OrderInput,
  key: string,
): { id: string; version: number } {
  requireRole(actor, ["admin", "operator"]);
  return operation(
    actor,
    key,
    "update_order",
    { id, version, input },
    "order",
    () => {
      const order = getOrder(actor, id);
      if (!order) throw new DomainError("Order not found", 404);
      if (order.version !== version)
        throw new DomainError(
          "This order changed. Reload before editing.",
          409,
        );
      const value = validateOrder(actor, input);
      if (value.status === "cancelled")
        throw new DomainError("Use the cancel action to cancel an order");
      if (!transitions[order.status].includes(value.status))
        throw new DomainError(`Cannot move ${order.status} to ${value.status}`);
      if (order.status === "cancelled" || order.status === "delivered")
        throw new DomainError("Finished orders cannot be edited", 409);
      const next = version + 1;
      db()
        .prepare(
          `UPDATE orders SET customer = ?, origin = ?, destination = ?, ship_date = ?, service_level = ?, assigned_user_id = ?, status = ?, notes = ?, version = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND version = ?`,
        )
        .run(
          value.customer,
          value.origin,
          value.destination,
          value.shipDate,
          value.serviceLevel,
          value.assignedUserId,
          value.status,
          value.notes,
          next,
          new Date().toISOString(),
          id,
          actor.organizationId,
          version,
        );
      return { id, result: { id, version: next } };
    },
  );
}

export function cancelOrder(
  actor: SessionUser,
  id: string,
  version: number,
  key: string,
): { id: string; version: number } {
  requireRole(actor, ["admin", "operator"]);
  return operation(actor, key, "cancel_order", { id, version }, "order", () => {
    const order: Order | null = getOrder(actor, id);
    if (!order) throw new DomainError("Order not found", 404);
    if (order.version !== version)
      throw new DomainError(
        "This order changed. Reload before cancelling.",
        409,
      );
    if (
      !transitions[order.status].includes("cancelled") ||
      order.status === "cancelled"
    )
      throw new DomainError(
        "Dispatched or finished orders cannot be cancelled",
        409,
      );
    const next = version + 1;
    db()
      .prepare(
        "UPDATE orders SET status = 'cancelled', version = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND version = ?",
      )
      .run(next, new Date().toISOString(), id, actor.organizationId, version);
    return { id, result: { id, version: next } };
  });
}

export function manageUser(
  actor: SessionUser,
  action: "create" | "update" | "deactivate",
  id: string,
  displayName: string,
  role: Role,
  key: string,
  expectedVersion: number,
): { id: string; version: number } {
  requireRole(actor, ["admin"]);
  return operation(
    actor,
    key,
    `${action}_user`,
    { id, displayName, role, expectedVersion },
    "user",
    () => {
      if (!["admin", "operator", "viewer"].includes(role))
        throw new DomainError("Invalid role");
      const name = nonempty(displayName, "Display name", 100);
      const userId = action === "create" ? randomUUID() : id;
      if (action === "create") {
        db()
          .prepare(
            "INSERT INTO users(id, organization_id, display_name, role) VALUES (?, ?, ?, ?)",
          )
          .run(userId, actor.organizationId, name, role);
      } else {
        const target = db()
          .prepare(
            "SELECT id, role, active, version FROM users WHERE id = ? AND organization_id = ?",
          )
          .get(id, actor.organizationId) as
          | { id: string; role: Role; active: number; version: number }
          | undefined;
        if (!target) throw new DomainError("User not found", 404);
        if (target.version !== expectedVersion || !target.active)
          throw new DomainError("User changed; reload before saving", 409);
        if (id === actor.id && (action === "deactivate" || role !== "admin"))
          throw new DomainError("You cannot remove your own admin access", 409);
        if (action === "deactivate") {
          const changed = db()
            .prepare(
              "UPDATE users SET active = 0, version = version + 1 WHERE id = ? AND organization_id = ? AND version = ?",
            )
            .run(id, actor.organizationId, expectedVersion);
          if (changed.changes !== 1)
            throw new DomainError("User changed; reload before saving", 409);
          db().prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
        } else {
          const changed = db()
            .prepare(
              "UPDATE users SET display_name = ?, role = ?, version = version + 1 WHERE id = ? AND organization_id = ? AND version = ?",
            )
            .run(name, role, id, actor.organizationId, expectedVersion);
          if (changed.changes !== 1)
            throw new DomainError("User changed; reload before saving", 409);
        }
      }
      return {
        id: userId,
        result: {
          id: userId,
          version: action === "create" ? 1 : expectedVersion + 1,
        },
      };
    },
  );
}
