import { isA2UIBasicFunction } from "./generative-ui/basic-functions";
import { A2UI_CHILD_LIST_REF } from "./generative-ui/child-refs";
import type { GenerativeUIManifest } from "./generative-ui/types";
import {
  defaultGenerativeUIPromptSpec,
  GUIDE_COMPONENTS,
  generativeUIPromptFeatures,
  selectPromptItems,
} from "./generative-ui/prompt-spec";
import type { GenerativeUIPromptSpec } from "./generative-ui/prompt-spec";
export {
  GENERATIVE_UI_MARKDOWN_WHEN_TO_SHOW,
  GENERATIVE_UI_WHEN_TO_SHOW,
} from "./generative-ui/prompt-spec";
/**
 * Default A2UI generation and design guideline prompts.
 *
 * These are the canonical prompt fragments that instruct an LLM how to call
 * the render_a2ui tool, how to bind data, and how to style surfaces.
 */

/**
 * Generation guidelines — protocol rules, tool arguments, path rules,
 * data model format, and form/two-way-binding instructions.
 */
export const A2UI_DEFAULT_GENERATION_GUIDELINES = `\
Generate A2UI v0.9 JSON.

## A2UI Protocol Instructions

A2UI (Agent to UI) is a protocol for rendering rich UI surfaces from agent responses.

CRITICAL: You MUST call the render_a2ui tool with ALL of these arguments:
- surfaceId: A unique ID for the surface (e.g. "product-comparison")
- components: REQUIRED — the A2UI component array. NEVER omit this. Only use
  components listed in the Available Components schema provided as context.
- data: OPTIONAL — a JSON object written to the root of the surface data model.
  Use for pre-filling form values or providing data for path-bound components.
- every component must have the "component" field specifying the component type.
  ONLY use component names from the Available Components schema — do NOT invent
  component names or use names not in the schema.

COMPONENT ID RULES:
- Exactly one component MUST have id="root". This is the surface's entry
  point — the renderer begins at "root" and walks the child/children tree
  from there. Every other component must be reachable from "root". If no
  component has id="root", the surface renders an empty loading placeholder
  and none of your components will be shown.
- Every component ID must be unique within the surface.
- A component MUST NOT reference itself as child/children. This causes a
  circular dependency error. For example, if a component has id="avatar",
  its child must be a DIFFERENT id (e.g. "avatar-img"), never "avatar".
- The child/children tree must be a DAG — no cycles allowed.

REPEATING CONTENT (TEMPLATES):
To repeat a component for each item in an array, use the structural children format:
  children: { componentId: "card-id", path: "/items" }
This tells the renderer to create one instance of "card-id" per item in the "/items" array.

PATH RULES FOR TEMPLATES:
Components inside a repeating template use RELATIVE paths (no leading slash).
The path is resolved relative to each array item automatically.
If a container has children: { componentId: "card", path: "/items" } and each item
has a key "name", use { "path": "name" } (NO leading slash — relative to item).
CRITICAL: Do NOT use "/name" (absolute) inside templates — use "name" (relative).
The container's path ("/items") uses a leading slash (absolute), but all
components INSIDE the template use paths WITHOUT leading slash.

COMPONENT VALUES — DEFAULT RULE:
Use inline literal values for ALL component properties. Pass strings, numbers,
arrays, and objects directly on the component. Do NOT use { "path": "..." }
objects unless the property's schema explicitly allows it (see exception below).
CRITICAL: USING { "path": "..." } ON A PROPERTY THAT DOES NOT DECLARE PATH
SUPPORT IN ITS SCHEMA WILL CAUSE A RUNTIME CRASH AND BREAK THE ENTIRE UI.
ALWAYS CHECK THE COMPONENT SCHEMA FIRST — IF THE PROPERTY ONLY ACCEPTS A
PLAIN TYPE, YOU MUST USE A LITERAL VALUE.
VERY IMPORTANT: THE APPLICATION WILL BREAK IF YOU DO NOT FOLLOW THIS RULE!

For example, a chart's "data" must always be an inline array:
  "data": [{"label": "Jan", "value": 100}, {"label": "Feb", "value": 200}]
A metric's "value" must always be an inline string:
  "value": "$1,200"

PATH BINDING EXCEPTION — SCHEMA-DRIVEN:
A few properties accept { "path": "/some/path" } as an alternative to a literal
value. You can identify these in the Available Components schema: the property
will list BOTH a literal type AND an object-with-path option. If a property only
shows a single type (string, number, array, etc.), it does NOT support path
binding — use a literal value only.

Path binding is typically used for editable form inputs so the client can write
user input back to the data model. When building forms:
- Bind input "value" to a data model path: "value": { "path": "/form/name" }
- Pre-fill via the "data" tool argument: "data": { "form": { "name": "Alice" } }
- Capture values on submit via button action context:
    "action": { "event": { "name": "submit", "context": { "name": { "path": "/form/name" } } } }

REPEATING CONTENT uses a structural children format (not the same as value binding):
  children: { componentId: "card-id", path: "/items" }
Components inside templates use RELATIVE paths (no leading slash): { "path": "name" }.`;

/**
 * Design guidelines — visual design rules, component hierarchy tips,
 * and action handler patterns.
 */
export const A2UI_DEFAULT_DESIGN_GUIDELINES = `\
Create polished, visually appealing interfaces. ONLY use components listed in the
Available Components schema — do NOT use component names that are not in the schema.

Design principles:
- Create clear visual hierarchy within cards and layouts.
- Keep cards clean — avoid clutter. Whitespace is good.
- Use consistent surfaceIds (lowercase, hyphenated).
- NEVER use the same ID for a component and its child — this creates a
  circular dependency. E.g. if id="avatar", child must NOT be "avatar".
- For side-by-side comparisons, use a container with structural children
  (children: { componentId, path }) to repeat a card template per data item.
- Include images when relevant (logos, icons, product photos):
  - Prefer company logos via Google favicons: https://www.google.com/s2/favicons?domain=example.com&sz=128
  - Do NOT invent Unsplash photo-IDs — they will 404. Only use real, known URLs.
- For buttons: action MUST use this exact nested format:
    "action": { "event": { "name": "myAction", "context": { "key": "value" } } }
  The "event" key holds an OBJECT with "name" (required) and "context" (optional).
  Do NOT use a flat format like {"event": "name"} — "event" must be an object.
- For forms: check the component schema — if an input's "value" property
  supports path binding, use it for editable fields. The submit button's
  action context should reference the same paths to capture user input.

Use the SAME surfaceId as the main surface. Match action names to button action event names.`;

/** Description of the context entry that carries `GENERATIVE_UI_MARKDOWN_GUIDELINES`. */
export const GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION =
  "Generative UI markdown guide: how to write UI surfaces inside ```a2ui code fences in a normal markdown reply.";

/**
 * Description of the context entry that carries the compact component schema
 * in the markdown transport.
 *
 * It must not equal `A2UI_SCHEMA_CONTEXT_DESCRIPTION` (the key that
 * `@ag-ui/a2ui-middleware` stamps for tool mode). The LangGraph and Strands
 * adapters find that exact string and move the entry into
 * `state["ag-ui"]["a2ui_schema"]` for the `render_a2ui` tool, so it never
 * gets to the system prompt. The markdown transport has no tool, so the
 * schema must stay ordinary context that the model reads as App Context.
 */
export const GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION =
  "Generative UI component schema: the components, props, events, slots, functions, and targets that ```a2ui code fences can use, and the surfaces that already exist.";

/** Which optional parts of A2UI a manifest uses. The guides leave out the rules for the others. */
export interface GenerativeUIGuideFeatures {
  /** A function is mounted: function calls and callRendererFunction. */
  functions: boolean;
  /** A component has an event prop. */
  events: boolean;
  /** A component has a "multiple" slot, which takes templates and @index. */
  templates: boolean;
  /** A component has a "checks" prop: validation rules on inputs. */
  checks: boolean;
  /**
   * The component names of the catalog. A guide line that names a standard
   * component missing from it is left out. Unset keeps every line.
   */
  components?: readonly string[];
}

/** Every optional rule group. Use it when the manifest is not known. */
export const ALL_GENERATIVE_UI_GUIDE_FEATURES: GenerativeUIGuideFeatures = {
  functions: true,
  events: true,
  templates: true,
  checks: true,
};

/**
 * The optional parts of A2UI that a manifest uses, so that a guide sends only
 * the rules that the model can apply.
 *
 * @param manifest - The components and the mounted functions of a run.
 * @returns Which optional rule groups the guides include.
 *
 * @example
 * ```ts
 * const guide = buildGenerativeUIMarkdownGuidelines(
 *   generativeUIGuideFeatures(manifest),
 * );
 * ```
 */
export function generativeUIGuideFeatures(
  manifest: Pick<GenerativeUIManifest, "components" | "functions">,
): GenerativeUIGuideFeatures {
  const components = Object.values(manifest.components);
  const hasChildList = (schema: unknown): boolean => {
    if (Array.isArray(schema)) return schema.some(hasChildList);
    if (typeof schema !== "object" || schema === null) return false;
    const node = schema as Record<string, unknown>;
    if (node.$ref === A2UI_CHILD_LIST_REF) return true;
    return Object.values(node).some(hasChildList);
  };
  return {
    components: Object.keys(manifest.components),
    // App functions only: the built-in ones are always there and have
    // their own rules.
    functions: Object.keys(manifest.functions).some(
      (name) => !isA2UIBasicFunction(name),
    ),
    events: components.some((c) => Object.keys(c.events ?? {}).length > 0),
    templates: components.some(
      (c) =>
        Object.values(c.slots ?? {}).includes("multiple") ||
        hasChildList(c.props),
    ),
    checks: components.some((c) => {
      const properties = c.props.properties;
      return (
        typeof properties === "object" &&
        properties !== null &&
        Object.prototype.hasOwnProperty.call(properties, "checks")
      );
    }),
  };
}

/**
 * Whether a guide line names only standard components (`GUIDE_COMPONENTS`,
 * also in the plural) that the catalog has. With no catalog, every line fits.
 */
function namesOnlyCatalogComponents(catalog: readonly string[] | undefined) {
  if (!catalog) return () => true;
  const has = new Set(catalog);
  return (line: string) =>
    (line.match(/\b[A-Z][A-Za-z0-9]*\b/g) ?? []).every((word) => {
      const name =
        !GUIDE_COMPONENTS.has(word) && word.endsWith("s")
          ? word.slice(0, -1)
          : word;
      return !GUIDE_COMPONENTS.has(name) || has.has(name);
    });
}

/**
 * Builds the markdown-transport guideline. The model writes A2UI v1.0
 * operations inside ```a2ui fences between normal markdown prose. The rules
 * for functions, events, and templates are left out when the manifest has
 * none of them, so the guideline stays small.
 *
 * @param features - The optional rule groups to include. Defaults to all.
 * @param spec - The wording. Defaults to the prompts that ship.
 * @returns The guideline text, one rule per line.
 */
export function buildGenerativeUIMarkdownGuidelines(
  features: GenerativeUIGuideFeatures = ALL_GENERATIVE_UI_GUIDE_FEATURES,
  spec: GenerativeUIPromptSpec = defaultGenerativeUIPromptSpec(),
) {
  const { intro, rules } = spec.markdown;
  const fits = namesOnlyCatalogComponents(features.components);
  const selected = selectPromptItems(
    rules,
    generativeUIPromptFeatures(features),
  ).filter(fits);
  const whenToShow = spec.markdown.whenToShow
    .split("\n")
    .filter(fits)
    .join("\n");
  const when = whenToShow ? `${whenToShow}\n\n` : "";
  return `${intro}\n\n${when}RULES\n${selected.map((rule) => `- ${rule}`).join("\n")}\n`;
}

/**
 * The markdown-transport guideline with every rule group. A run sends
 * `buildGenerativeUIMarkdownGuidelines` for its own manifest instead.
 */
export const GENERATIVE_UI_MARKDOWN_GUIDELINES =
  buildGenerativeUIMarkdownGuidelines();
