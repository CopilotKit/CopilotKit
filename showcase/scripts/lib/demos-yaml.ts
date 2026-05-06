import yaml from "yaml";

export type DemoCatalogEntry = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: string[];
  readonly route_template: string;
  readonly frontend_highlight: string[];
};

export type ParseResult =
  | { kind: "ok"; entries: DemoCatalogEntry[] }
  | { kind: "malformed"; reason: string };

export function parseDemoCatalog(yamlText: string): ParseResult {
  let parsed: unknown;
  try { parsed = yaml.parse(yamlText); }
  catch (e) { return { kind: "malformed", reason: `yaml parse: ${(e as Error).message}` }; }
  if (parsed === null || parsed === undefined) return { kind: "ok", entries: [] };
  if (!Array.isArray(parsed)) return { kind: "malformed", reason: "top level must be array" };

  const entries: DemoCatalogEntry[] = [];
  for (const [idx, raw] of parsed.entries()) {
    if (typeof raw !== "object" || raw === null) return { kind: "malformed", reason: `entry ${idx} not object` };
    const e = raw as Record<string, unknown>;
    if (typeof e.id !== "string" || e.id.length === 0) return { kind: "malformed", reason: `entry ${idx}: missing id` };
    if (typeof e.name !== "string") return { kind: "malformed", reason: `${e.id}: missing name` };
    if (typeof e.description !== "string") return { kind: "malformed", reason: `${e.id}: missing description` };
    if (!Array.isArray(e.tags)) return { kind: "malformed", reason: `${e.id}: tags not array` };
    if (typeof e.route_template !== "string") return { kind: "malformed", reason: `${e.id}: missing route_template` };
    if (!Array.isArray(e.frontend_highlight)) return { kind: "malformed", reason: `${e.id}: frontend_highlight not array` };
    entries.push({
      id: e.id, name: e.name, description: e.description,
      tags: e.tags as string[], route_template: e.route_template,
      frontend_highlight: e.frontend_highlight as string[],
    });
  }
  return { kind: "ok", entries };
}
