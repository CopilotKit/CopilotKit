import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { ensureSchema, TEMPLATES } from "@/lib/db-seed";
import type { SavedDashboard } from "@/types/dashboard";

let schemaReady = false;
async function init() {
  if (!schemaReady && sql) {
    await ensureSchema();
    schemaReady = true;
  }
}

// In-memory fallback when no Postgres is available
function getTemplatesAsSaved(): SavedDashboard[] {
  const now = new Date().toISOString();
  return TEMPLATES.map((t, i) => ({
    id: `template-${i}`,
    name: t.name,
    description: t.description,
    category: "template" as const,
    widgets: t.widgets,
    createdAt: now,
    updatedAt: now,
  }));
}

// localStorage-based custom dashboards are stored client-side;
// when no DB, the API only serves templates and the client handles custom storage.
const FALLBACK_STORAGE_KEY = "finance-erp-dashboards";

// GET /api/dashboards — list all, templates first
export async function GET() {
  await init();

  if (sql) {
    const rows = await sql`
      SELECT id, name, description, category, widgets, created_at, updated_at
      FROM dashboards
      ORDER BY
        CASE WHEN category = 'template' THEN 0 ELSE 1 END,
        updated_at DESC
    `;
    const dashboards = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      widgets: r.widgets,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    }));
    return NextResponse.json(dashboards);
  }

  // Fallback: return hardcoded templates only (custom dashboards live in localStorage on client)
  return NextResponse.json(getTemplatesAsSaved());
}

// POST /api/dashboards — create new dashboard
export async function POST(request: Request) {
  await init();
  const body = await request.json();
  const { name, description, widgets, category } = body;

  if (!name || !widgets) {
    return NextResponse.json(
      { error: "name and widgets are required" },
      { status: 400 },
    );
  }

  if (sql) {
    const [row] = await sql`
      INSERT INTO dashboards (name, description, category, widgets)
      VALUES (${name}, ${description ?? null}, ${category ?? "custom"}, ${JSON.stringify(widgets)})
      RETURNING id, name, description, category, widgets, created_at, updated_at
    `;
    return NextResponse.json(
      {
        id: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        widgets: row.widgets,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      },
      { status: 201 },
    );
  }

  // Fallback: return a fake saved entry (client will persist to localStorage)
  const now = new Date().toISOString();
  return NextResponse.json(
    {
      id: crypto.randomUUID(),
      name,
      description: description ?? null,
      category: category ?? "custom",
      widgets,
      createdAt: now,
      updatedAt: now,
    },
    { status: 201 },
  );
}
