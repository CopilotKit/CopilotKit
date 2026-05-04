// showcase/integrations/nextjs/src/lib/manifests.ts
import yaml from "yaml";

export type DemoCatalogEntry = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  route_template: string;
  frontend_highlight: string[];
};

export function loadDemoCatalog(yamlText: string): DemoCatalogEntry[] {
  const parsed = yaml.parse(yamlText);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry, idx) => {
    if (typeof entry !== "object" || entry === null)
      throw new Error(`demos.yaml entry ${idx}: expected object`);
    const o = entry as Record<string, unknown>;
    if (typeof o.id !== "string" || o.id.length === 0)
      throw new Error(`demos.yaml entry ${idx}: missing id`);
    if (typeof o.name !== "string") throw new Error(`demos.yaml ${o.id}: missing name`);
    if (typeof o.description !== "string") throw new Error(`demos.yaml ${o.id}: missing description`);
    if (!Array.isArray(o.tags)) throw new Error(`demos.yaml ${o.id}: tags must be array`);
    if (typeof o.route_template !== "string") throw new Error(`demos.yaml ${o.id}: missing route_template`);
    if (!Array.isArray(o.frontend_highlight)) throw new Error(`demos.yaml ${o.id}: frontend_highlight must be array`);
    return {
      id: o.id, name: o.name, description: o.description,
      tags: o.tags as string[], route_template: o.route_template,
      frontend_highlight: o.frontend_highlight as string[],
    };
  });
}
