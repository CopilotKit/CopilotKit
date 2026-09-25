import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type Role = "admin" | "operator" | "viewer";
export type OrderStatus =
  | "draft"
  | "booked"
  | "in_transit"
  | "delivered"
  | "cancelled";
export type ServiceLevel = "standard" | "express" | "priority";

export interface SessionUser {
  id: string;
  organizationId: string;
  organizationName: string;
  displayName: string;
  role: Role;
}

export interface Order {
  id: string;
  organization_id: string;
  reference: string;
  customer: string;
  origin: string;
  destination: string;
  ship_date: string;
  service_level: ServiceLevel;
  assigned_user_id: string | null;
  status: OrderStatus;
  notes: string;
  version: number;
  created_at: string;
  updated_at: string;
}

let singleton: DatabaseSync | undefined;

export function db(): DatabaseSync {
  if (singleton) return singleton;
  const file = resolve(
    process.env.NORTHSTAR_DB_PATH || "data/northstar.sqlite",
  );
  mkdirSync(dirname(file), { recursive: true });
  singleton = new DatabaseSync(file);
  singleton.exec(
    "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
  );
  singleton.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
      display_name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','operator','viewer')),
      active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
      reference TEXT NOT NULL UNIQUE, customer TEXT NOT NULL,
      origin TEXT NOT NULL, destination TEXT NOT NULL, ship_date TEXT NOT NULL,
      service_level TEXT NOT NULL CHECK (service_level IN ('standard','express','priority')),
      assigned_user_id TEXT REFERENCES users(id),
      status TEXT NOT NULL CHECK (status IN ('draft','booked','in_transit','delivered','cancelled')),
      notes TEXT NOT NULL DEFAULT '', private_note TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS operations (
      operation_key TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      action TEXT NOT NULL, payload_hash TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS orders_by_org ON orders(organization_id, updated_at DESC);
  `);
  const columns = singleton
    .prepare("PRAGMA table_info(operations)")
    .all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "payload_hash")) {
    singleton.exec(
      "ALTER TABLE operations ADD COLUMN payload_hash TEXT NOT NULL DEFAULT ''",
    );
  }
  const userColumns = singleton
    .prepare("PRAGMA table_info(users)")
    .all() as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === "version")) {
    singleton.exec(
      "ALTER TABLE users ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
    );
  }
  return singleton;
}

export function listDemoAccounts(): SessionUser[] {
  return db()
    .prepare(`SELECT u.id, u.organization_id AS organizationId,
    o.name AS organizationName, u.display_name AS displayName, u.role
    FROM users u JOIN organizations o ON o.id = u.organization_id
    WHERE u.active = 1 ORDER BY o.name, u.role, u.display_name`)
    .all() as unknown as SessionUser[];
}

export function createSession(userId: string): string {
  const user = db()
    .prepare("SELECT id FROM users WHERE id = ? AND active = 1")
    .get(userId);
  if (!user) throw new Error("Account unavailable");
  const token = randomUUID() + randomUUID();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  db()
    .prepare(
      "INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)",
    )
    .run(token, userId, expiresAt);
  return token;
}

export function deleteSession(token: string): void {
  db().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function sessionUser(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db()
    .prepare(`SELECT u.id, u.organization_id AS organizationId,
    o.name AS organizationName, u.display_name AS displayName, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    JOIN organizations o ON o.id = u.organization_id
    WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`)
    .get(token, new Date().toISOString()) as unknown as SessionUser | undefined;
  return row ? { ...row } : null;
}

export function listOrders(user: SessionUser, query = ""): Order[] {
  const search = `%${query.trim()}%`;
  return db()
    .prepare(`SELECT id, organization_id, reference, customer, origin, destination,
    ship_date, service_level, assigned_user_id, status, notes, version, created_at, updated_at
    FROM orders WHERE organization_id = ?
    AND (reference LIKE ? OR customer LIKE ? OR destination LIKE ?)
    ORDER BY updated_at DESC, reference DESC`)
    .all(user.organizationId, search, search, search) as unknown as Order[];
}

export function getOrder(user: SessionUser, id: string): Order | null {
  return (
    (db()
      .prepare(`SELECT id, organization_id, reference, customer, origin, destination,
      ship_date, service_level, assigned_user_id, status, notes, version, created_at, updated_at
      FROM orders WHERE id = ? AND organization_id = ?`)
      .get(id, user.organizationId) as unknown as Order | undefined) ?? null
  );
}

export function listUsers(user: SessionUser) {
  return db()
    .prepare(
      "SELECT id, display_name, role, active, version FROM users WHERE organization_id = ? ORDER BY display_name",
    )
    .all(user.organizationId) as Array<{
    id: string;
    display_name: string;
    role: Role;
    active: number;
    version: number;
  }>;
}
