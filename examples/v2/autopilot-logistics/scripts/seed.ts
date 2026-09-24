import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";

const database = db();
if (process.argv.includes("--reset")) {
  database.exec(
    "DELETE FROM operations; DELETE FROM sessions; DELETE FROM orders; DELETE FROM users; DELETE FROM organizations;",
  );
}

const count = database
  .prepare("SELECT count(*) AS count FROM organizations")
  .get() as { count: number };
if (count.count === 0) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const org = database.prepare(
      "INSERT INTO organizations(id, name) VALUES (?, ?)",
    );
    org.run("northstar", "Northstar Logistics");
    org.run("other-co", "Harbor Freight Demo");
    const user = database.prepare(
      "INSERT INTO users(id, organization_id, display_name, role) VALUES (?, ?, ?, ?)",
    );
    for (const [id, orgId, name, role] of [
      ["admin", "northstar", "Avery Morgan", "admin"],
      ["operator", "northstar", "Jordan Lee", "operator"],
      ["viewer", "northstar", "Sam Rivera", "viewer"],
      ["other-admin", "other-co", "Morgan Chen", "admin"],
      ["other-operator", "other-co", "Casey Park", "operator"],
    ])
      user.run(id, orgId, name, role);

    const insert =
      database.prepare(`INSERT INTO orders(id, organization_id, reference, customer,
      origin, destination, ship_date, service_level, assigned_user_id, status,
      notes, private_note, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
    const now = new Date().toISOString();
    const customers = [
      "Aurora Medical",
      "Aurora Med Devices",
      "Atlas Paper",
      "Boreal Foods",
      "Cedar Labs",
      "Delta Textiles",
      "Elm Manufacturing",
      "Fable Retail",
      "Granite Foods",
      "Horizon Bio",
      "Indigo Works",
      "Juniper Supply",
    ];
    customers.forEach((customer, index) => {
      const status =
        index === 8 ? "cancelled" : index === 9 ? "in_transit" : "booked";
      insert.run(
        randomUUID(),
        "northstar",
        `NS-${String(1201 + index)}`,
        customer,
        `${100 + index} Example Way, Portland, OR`,
        `${200 + index} Sample Ave, Seattle, WA`,
        `2026-10-${String(5 + index).padStart(2, "0")}`,
        index % 3 === 0 ? "express" : "standard",
        "operator",
        status,
        index === 0 ? "Deliver before noon." : "",
        index === 0 ? "CANARY-NORTHSTAR-PRIVATE-7Q4M" : "",
        now,
        now,
      );
    });
    insert.run(
      randomUUID(),
      "other-co",
      "HF-2001",
      "Harbor Client",
      "1 Fiction Street, Oakland, CA",
      "2 Fiction Street, Reno, NV",
      "2026-10-18",
      "priority",
      "other-operator",
      "booked",
      "",
      "",
      now,
      now,
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
console.log("Northstar seed ready");
