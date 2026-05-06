import yaml from "yaml";

export type ManifestV2Demo = { readonly id: string; readonly backend_highlight: string[] };
export type ManifestV2 = {
  readonly name: string;
  readonly slug: string;
  readonly language: "python" | "typescript" | "dotnet" | "java";
  readonly description: string;
  readonly logo?: string;
  readonly category?: string;
  readonly managed_platform?: { name: string; url: string };
  readonly partner_docs?: string | null;
  readonly repo?: string;
  readonly copilotkit_version?: string;
  readonly backend_url: string;
  readonly deployed: boolean;
  readonly sort_order?: number;
  readonly a2ui_pattern?: string;
  readonly interrupt_pattern?: string;
  readonly agent_config_pattern?: string;
  readonly auth_pattern?: string;
  readonly demos: ManifestV2Demo[];
};
export type ParseResult =
  | { kind: "ok"; manifest: ManifestV2 }
  | { kind: "malformed"; reason: string };

const REQUIRED = ["name", "slug", "language", "description", "backend_url", "deployed", "demos"] as const;

export function parseManifestV2(yamlText: string): ParseResult {
  let parsed: unknown;
  try { parsed = yaml.parse(yamlText); }
  catch (e) { return { kind: "malformed", reason: `yaml parse: ${(e as Error).message}` }; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return { kind: "malformed", reason: "top level must be object" };
  const obj = parsed as Record<string, unknown>;
  for (const key of REQUIRED)
    if (!(key in obj)) return { kind: "malformed", reason: `missing field '${key}'` };
  if (typeof obj.slug !== "string" || obj.slug.length === 0) return { kind: "malformed", reason: "slug must be non-empty string" };
  if (typeof obj.name !== "string") return { kind: "malformed", reason: "name must be string" };
  if (typeof obj.description !== "string") return { kind: "malformed", reason: "description must be string" };
  if (typeof obj.backend_url !== "string") return { kind: "malformed", reason: "backend_url must be string" };
  if (typeof obj.deployed !== "boolean") return { kind: "malformed", reason: "deployed must be boolean" };
  if (!["python", "typescript", "dotnet", "java"].includes(obj.language as string))
    return { kind: "malformed", reason: `language invalid: ${obj.language}` };
  if (!Array.isArray(obj.demos)) return { kind: "malformed", reason: "demos must be array" };

  const demos: ManifestV2Demo[] = [];
  for (const [idx, raw] of (obj.demos as unknown[]).entries()) {
    if (typeof raw !== "object" || raw === null) return { kind: "malformed", reason: `demos[${idx}] not object` };
    const d = raw as Record<string, unknown>;
    if (typeof d.id !== "string" || d.id.length === 0) return { kind: "malformed", reason: `demos[${idx}].id missing` };
    if (!Array.isArray(d.backend_highlight)) return { kind: "malformed", reason: `demos[${d.id}].backend_highlight must be array` };
    demos.push({ id: d.id, backend_highlight: d.backend_highlight as string[] });
  }

  return {
    kind: "ok",
    manifest: {
      name: obj.name as string,
      slug: obj.slug as string,
      language: obj.language as ManifestV2["language"],
      description: obj.description as string,
      logo: typeof obj.logo === "string" ? obj.logo : undefined,
      category: typeof obj.category === "string" ? obj.category : undefined,
      managed_platform: obj.managed_platform as ManifestV2["managed_platform"],
      partner_docs: (obj.partner_docs as string | null | undefined) ?? null,
      repo: typeof obj.repo === "string" ? obj.repo : undefined,
      copilotkit_version: typeof obj.copilotkit_version === "string" ? obj.copilotkit_version : undefined,
      backend_url: obj.backend_url as string,
      deployed: obj.deployed as boolean,
      sort_order: typeof obj.sort_order === "number" ? obj.sort_order : undefined,
      a2ui_pattern: typeof obj.a2ui_pattern === "string" ? obj.a2ui_pattern : undefined,
      interrupt_pattern: typeof obj.interrupt_pattern === "string" ? obj.interrupt_pattern : undefined,
      agent_config_pattern: typeof obj.agent_config_pattern === "string" ? obj.agent_config_pattern : undefined,
      auth_pattern: typeof obj.auth_pattern === "string" ? obj.auth_pattern : undefined,
      demos,
    },
  };
}
