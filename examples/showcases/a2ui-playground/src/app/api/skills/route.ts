// Agent skills generated from the catalog (see `src/a2ui/export/skills.ts`).
//   GET  /api/skills?format=express            -> { files: [{ path, content }] }   the whole catalog
//   GET  /api/skills?format=express&download=1 -> skills.zip
//   POST /api/skills { format, name?, components?, notes?, download? }  a skill for a selection (the /skills builder)
import { generateSkills, skillComponents, skillName, type SkillFormat, type SkillSelection } from "@/a2ui/export/skills";
import { MAX_BODY, RATE_LIMITS, rateLimiter, readBody, tooLarge } from "@/lib/limits";
import { zip } from "@/lib/zip";

export const runtime = "nodejs";

const limit = rateLimiter(RATE_LIMITS.skills);
const KNOWN = new Set(skillComponents().map((c) => c.name));

function respond(format: SkillFormat, selection: SkillSelection, download: boolean) {
  const files = generateSkills(format, selection);
  if (download) {
    const bytes = zip(Object.fromEntries(Object.entries(files).map(([path, text]) => [`skills/${path}`, text])));
    return new Response(bytes as unknown as BodyInit, {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${skillName(selection.name)}-skills-${format}.zip"` },
    });
  }
  return Response.json({ format, files: Object.entries(files).map(([path, content]) => ({ path, content })) });
}

export function GET(request: Request) {
  const limited = limit(request);
  if (limited) return limited;
  const url = new URL(request.url);
  const format: SkillFormat = url.searchParams.get("format") === "json" ? "json" : "express";
  return respond(format, {}, Boolean(url.searchParams.get("download")));
}

export async function POST(request: Request) {
  const limited = limit(request);
  if (limited) return limited;
  const text = await readBody(request, MAX_BODY.skills);
  if (text === null) return tooLarge("The selection is too large.");
  let body: Record<string, unknown> | null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!body) return Response.json({ error: "Send the selection as JSON." }, { status: 400 });
  const components = Array.isArray(body.components) ? body.components.filter((c): c is string => typeof c === "string" && KNOWN.has(c)) : undefined;
  if (components && !components.length) return Response.json({ error: "Pick at least one component." }, { status: 400 });
  const notes = body.notes && typeof body.notes === "object" ? (body.notes as Record<string, string>) : undefined;
  const format: SkillFormat = body.format === "json" ? "json" : "express";
  return respond(format, { name: typeof body.name === "string" ? body.name : undefined, components, notes }, Boolean(body.download));
}
