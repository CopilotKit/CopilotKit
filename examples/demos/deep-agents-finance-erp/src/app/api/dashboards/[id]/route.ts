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

function findTemplate(id: string): SavedDashboard | null {
  if (!id.startsWith("template-")) return null;
  const idx = parseInt(id.replace("template-", ""), 10);
  const t = TEMPLATES[idx];
  if (!t) return null;
  const now = new Date().toISOString();
  return {
    id,
    name: t.name,
    description: t.description,
    category: "template",
    widgets: t.widgets,
    createdAt: now,
    updatedAt: now,
  };
}

// GET /api/dashboards/:id
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await init();
  const { id } = await params;

  if (sql) {
    const [row] = await sql`
      SELECT id, name, description, category, widgets, created_at, updated_at
      FROM dashboards WHERE id = ${id}
    `;
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      widgets: row.widgets,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    });
  }

  // Fallback: check hardcoded templates
  const template = findTemplate(id);
  if (template) return NextResponse.json(template);
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

// PUT /api/dashboards/:id — update (custom only)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await init();
  const { id } = await params;

  if (!sql) {
    return NextResponse.json(
      { error: "No database configured" },
      { status: 501 },
    );
  }

  const [existing] = await sql`
    SELECT category FROM dashboards WHERE id = ${id}
  `;
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.category === "template") {
    return NextResponse.json(
      { error: "Cannot modify templates" },
      { status: 403 },
    );
  }

  const body = await request.json();
  const { name, description, widgets } = body;

  const [row] = await sql`
    UPDATE dashboards
    SET
      name = COALESCE(${name ?? null}, name),
      description = COALESCE(${description ?? null}, description),
      widgets = COALESCE(${widgets ? JSON.stringify(widgets) : null}::jsonb, widgets),
      updated_at = now()
    WHERE id = ${id}
    RETURNING id, name, description, category, widgets, created_at, updated_at
  `;

  return NextResponse.json({
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    widgets: row.widgets,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

// DELETE /api/dashboards/:id — delete (custom only)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await init();
  const { id } = await params;

  if (!sql) {
    // No DB — client handles localStorage deletion
    return NextResponse.json({ ok: true });
  }

  const [existing] = await sql`
    SELECT category FROM dashboards WHERE id = ${id}
  `;
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.category === "template") {
    return NextResponse.json(
      { error: "Cannot delete templates" },
      { status: 403 },
    );
  }

  await sql`DELETE FROM dashboards WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
