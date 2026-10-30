/**
 * Serializes the catalog the browser sent (the A2UI 1.0 inline catalog of the
 * generative UI envelope) into a compact, token-cheap signature list for the
 * composing sub-agent. Full JSON Schema for ~120 components is far too long;
 * this form is a few thousand tokens and the model composes just as well.
 *
 *   Stat(label:S, value:S|N, delta?:S, trend?:up|down|flat): One KPI ...
 *
 * `S`/`N`/`B` are string/number/boolean. `#id` is a component id, `#ids` a
 * list of ids or a `{componentId,path}` template. Every value may also be a
 * `{"@path"}` binding or a `{"@call"}` function call (A2UI 1.0).
 */
import { createHash } from "node:crypto";
import {
  A2UI_CHILD_LIST_MARK,
  A2UI_COMPONENT_ID_MARK,
  type GenerativeUIManifest,
} from "@copilotkit/shared";
import { definitions } from "@/a2ui/catalog/definitions";
import type { Category } from "@/a2ui/catalog/definitions/shared";
import { firstSentence, STYLE_PROPS } from "@/a2ui/catalog/prompt-trim";
import inference from "@/a2ui/export/inference-catalog.json";
import { MACROS } from "@/a2ui/macros/macros";
import { MAX_CATALOG_PROMPT_CHARS } from "@/lib/limits";

type Schema = Record<string, unknown>;

/** Internal stand-ins the agent emits itself; the model never writes them. */
const HIDDEN = new Set(["Blueprint"]);

const DYNAMIC_REF = /common_types\.json#\/\$defs\/(DataBinding|FunctionCall)$/;

/** A catalog schema with its `{"@path"}` / `{"@call"}` alternatives removed: the literal shape a prop takes. */
function literal(s: Schema): Schema {
  if (Array.isArray(s.anyOf)) {
    const rest = (s.anyOf as Schema[]).filter(
      (u) => !(typeof u.$ref === "string" && DYNAMIC_REF.test(u.$ref)),
    );
    if (rest.length === 1)
      return literal({
        ...rest[0],
        ...(s.description ? { description: s.description } : {}),
      });
    return { ...s, anyOf: rest.map(literal) };
  }
  const out: Schema = { ...s };
  if (s.items && typeof s.items === "object")
    out.items = literal(s.items as Schema);
  if (s.properties)
    out.properties = Object.fromEntries(
      Object.entries(s.properties as Record<string, Schema>).map(([k, v]) => [
        k,
        literal(v),
      ]),
    );
  return out;
}

function refMark(s: Schema) {
  const d = typeof s.description === "string" ? s.description : "";
  if (d.startsWith(A2UI_COMPONENT_ID_MARK)) return "#id";
  if (d.startsWith(A2UI_CHILD_LIST_MARK)) return "#ids";
  return undefined;
}

function sig(s: unknown, depth = 0): string {
  if (!s || typeof s !== "object") return "any";
  const schema = s as Schema;
  const ref = refMark(schema);
  if (ref) return ref;
  if (Array.isArray(schema.enum)) return schema.enum.map(String).join("|");
  if ("const" in schema) return JSON.stringify(schema.const);
  const union = (schema.anyOf ?? schema.oneOf) as unknown[] | undefined;
  if (Array.isArray(union))
    return union.map((o) => sig(o, depth + 1)).join("|");
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case "string":
      return "S";
    case "number":
    case "integer":
      return "N";
    case "boolean":
      return "B";
    case "array":
      return `[${sig(schema.items, depth + 1)}]`;
    case "object": {
      const props = schema.properties as Record<string, unknown> | undefined;
      if (!props) return "{..}";
      if (depth > 3) return "{..}";
      return `{${fields(schema, depth + 1)}}`;
    }
    default:
      return "any";
  }
}

function fields(schema: Schema, depth = 0, skip?: Set<string>) {
  const props = (schema.properties ?? {}) as Record<string, unknown>;
  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as string[]) : [],
  );
  return Object.entries(props)
    .filter(([k]) => required.has(k) || !skip?.has(k))
    .map(([k, v]) => `${k}${required.has(k) ? "" : "?"}:${sig(v, depth)}`)
    .join(", ");
}

function componentLine(
  name: string,
  c: GenerativeUIManifest["components"][string],
  standard: boolean,
) {
  const parts = [fields(c.props, 0, standard ? STYLE_PROPS : undefined)];
  for (const [slot, kind] of Object.entries(c.slots ?? {}))
    parts.push(`${slot}?:${kind === "single" ? "#id" : "#ids"}`);
  for (const event of Object.keys(c.events ?? {}))
    parts.push(`${event}?:Action`);
  const params = parts.filter(Boolean).join(", ");
  const text = c.description
    ? standard
      ? firstSentence(c.description)
      : c.description.replace(/\s+/g, " ").trim()
    : "";
  const description = text ? `: ${text}` : "";
  return `${name}(${params})${description}`;
}

function functionLine(
  name: string,
  f: GenerativeUIManifest["functions"][string],
) {
  // A built-in function carries its short signature in the description of its parameters.
  const params = f.parameters as Schema;
  const signature =
    typeof params.description === "string"
      ? params.description
      : `${name}(${fields(params)})`;
  return `${signature}${f.description ? `: ${f.description.replace(/\s+/g, " ").trim()}` : ""}`;
}

const cache = new Map<string, string>();

/**
 * The COMPONENTS and FUNCTIONS sections of the composer prompt. Identical for
 * the same catalog, so OpenAI prompt caching applies across requests.
 * The catalog comes from the browser: it is cached by its content, so no
 * request can change the prompt another visitor's run reads, and one too
 * large for a real catalog is refused.
 */
export function catalogPrompt(manifest: GenerativeUIManifest): string {
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        manifest.catalogId,
        manifest.components,
        manifest.functions,
      ]),
    )
    .digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;

  const own = definitions as Record<string, { category: Category }>;
  const groups = new Map<string, string[]>();
  for (const [name, c] of Object.entries(manifest.components)) {
    if (HIDDEN.has(name)) continue;
    const group = own[name]
      ? `This app: ${own[name].category}`
      : "Gen UI 2.0 standard";
    const lines = groups.get(group) ?? [];
    lines.push(componentLine(name, c, !own[name]));
    groups.set(group, lines);
  }
  // Macros are not in the browser's catalog: the server expands them into standard components.
  groups.set(
    "Macros (one component here, expanded into standard components on the server)",
    MACROS.map((m) => {
      const schema = literal(
        (inference.components as Record<string, Schema>)[m.name],
      );
      const { component: _c, ...props } = schema.properties as Record<
        string,
        Schema
      >;
      void _c;
      const actions = Object.keys(props).filter(
        (k) =>
          typeof props[k].$ref === "string" &&
          (props[k].$ref as string).endsWith("/Action"),
      );
      const params = fields({
        ...schema,
        properties: Object.fromEntries(
          Object.entries(props).filter(([k]) => !actions.includes(k)),
        ),
      });
      return `${m.name}(${[params, ...actions.map((e) => `${e}?:Action`)].filter(Boolean).join(", ")}): ${m.description}`;
    }),
  );
  const components = Array.from(groups.entries())
    .map(([group, lines]) => `### ${group}\n${lines.join("\n")}`)
    .join("\n\n");
  const functions = Object.entries(manifest.functions)
    .filter(([, f]) => !f.allowedCallers || f.allowedCallers !== "agentOnly")
    .map(([name, f]) => functionLine(name, f))
    .join("\n");
  const prompt = `COMPONENTS\n${components}\n\nFUNCTIONS (use as {"@call":"name","args":{...}} in any prop value)\n${functions}`;
  if (prompt.length > MAX_CATALOG_PROMPT_CHARS)
    throw new Error("The catalog sent with this request is too large.");
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(key, prompt);
  return prompt;
}
