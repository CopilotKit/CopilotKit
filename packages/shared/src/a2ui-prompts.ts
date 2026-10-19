import type { GenerativeUIManifest } from "./generative-ui/types";
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
}

/** Every optional rule group. Use it when the manifest is not known. */
export const ALL_GENERATIVE_UI_GUIDE_FEATURES: GenerativeUIGuideFeatures = {
  functions: true,
  events: true,
  templates: true,
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
  return {
    functions: Object.keys(manifest.functions).length > 0,
    events: components.some((c) => Object.keys(c.events ?? {}).length > 0),
    templates: components.some((c) =>
      Object.values(c.slots ?? {}).includes("multiple"),
    ),
  };
}

/** The first rules of every markdown guideline, before the optional groups. */
const MARKDOWN_BASE_RULES = [
  "Write explanations as normal markdown prose outside the fences.",
  "Open a fence with ```a2ui to show the surface in the chat, at the place of the fence.",
  'Open a fence with ```a2ui target=<id> to show the surface in a named target. Use only target ids from the schema. When a target has "components", its surfaces can use only those components.',
  "Inside a fence, write one JSON object per line and nothing else. No comments, no trailing commas, no pretty-printing.",
  "Keep each operation whole on its line.",
  'Give every operation "version":"v1.0".',
  `Start a surface with one createSurface. Put all the initial data in "dataModel" and the "root" component in "components". Then write the children in updateComponents lines, so that they show while you write:
  \`\`\`a2ui
  {"version":"v1.0","createSurface":{"surfaceId":"plan-picker","dataModel":{ ...initial data... },"components":[{"id":"root","component":"<Name>","children":["seats","pick"]}]}}
  {"version":"v1.0","updateComponents":{"surfaceId":"plan-picker","components":[ ...the children... ]}}
  \`\`\``,
  'Every surface renders from the component with id "root". Make every other component reachable from "root" through slots.',
  "Use unique ids. Do not make cycles. A component cannot be its own child.",
  'Write a component as one flat object: {"id":"title","component":"<Name>","text":"Hello"}.',
  'Put the component name in "component" (never "type"). Put props next to it, never inside a "props" object.',
  'Use only the components, props, events, and slots in the schema. A component with "includesCommonProps" also takes every prop in "commonProps".',
  'Give a prop a literal value, or bind it to the data model with {"@path":"/x"}. Never write {"path":"/x"} as a binding.',
  'Bind a writable prop to let the user edit it: "value":{"@path":"/form/email"}. The user\'s input goes to that path.',
  'To change data, write updateDataModel with a "path" and a "value": {"version":"v1.0","updateDataModel":{"surfaceId":"plan-picker","path":"/seats","value":12}}. Always give "value".',
  'Set "value":null to delete the key at "path".',
];

/** The last rules of every markdown guideline, after the optional groups. */
const MARKDOWN_CLOSING_RULES = [
  'The schema lists the surfaces that already exist under "surfaces". "dataModel" holds the values that the user entered: read them, and do not write those paths. "rejected" lists operations that the client dropped: send corrected operations in a new fence for that surfaceId.',
  "Never make a surface that is only prose. Write headings, paragraphs, lists of text, intros, and summaries as markdown outside the fences, also between two fences.",
  "Put in a fence only what markdown cannot show: charts, tables, maps, images, badges, inputs, buttons, cards with controls.",
  "Use Card only for an interactive panel (controls, a form, a configurator). Put everything else in a plain layout component.",
  "Never wrap the whole reply in a fence.",
];

/**
 * Builds the markdown-transport guideline. The model writes A2UI v1.0
 * operations inside ```a2ui fences between normal markdown prose. The rules
 * for functions, events, and templates are left out when the manifest has
 * none of them, so the guideline stays small.
 *
 * @param features - The optional rule groups to include. Defaults to all.
 * @returns The guideline text, one rule per line.
 */
export function buildGenerativeUIMarkdownGuidelines(
  features: GenerativeUIGuideFeatures = ALL_GENERATIVE_UI_GUIDE_FEATURES,
) {
  const { functions, events, templates } = features;
  const rules = [...MARKDOWN_BASE_RULES];
  if (events) {
    rules.push(
      functions
        ? 'Give an event prop an object: {"event":{"name":"<name>","userMessage":"<text>","context":{...}}} or {"functionCall":{"@call":"<function>","args":{...}}}. Never a flat {"event":"<name>"}.'
        : 'Give an event prop an object: {"event":{"name":"<name>","userMessage":"<text>","context":{...}}}. Never a flat {"event":"<name>"}.',
    );
    if (functions) {
      rules.push(
        'Use {"functionCall": ...} to run an app function in the browser when the user clicks. Use only functions from the schema. You are not told about the call.',
      );
    }
    rules.push(
      'Use {"event": ...} to send the interaction back to you as a user message. Put the text of that message in "userMessage": {"event":{"name":"choose","userMessage":"Show me the Team plan"}}.',
      'To send input values with an event, bind them in the context: "context":{"email":{"@path":"/form/email"}}.',
      functions
        ? "A button or other event prop without an event or functionCall does nothing."
        : "A button or other event prop without an event does nothing.",
    );
  }
  rules.push(
    templates
      ? 'Never put {"@call": ...} or an expression in a data prop. Compute derived values (totals, prices) yourself and write them as literals or into the data model. The only exception is {"@call":"@index"} in a template.'
      : 'Never put {"@call": ...} or an expression in a data prop. Compute derived values (totals, prices) yourself and write them as literals or into the data model.',
    'Give a slot component ids: "child":"card" for a single slot, "children":["a","b"] for a multiple slot.',
  );
  if (templates) {
    rules.push(
      'To repeat a component for each item of a list, give a multiple slot a template: "children":{"componentId":"row","path":"/items"}.',
      'Inside a template, paths are relative to the item ("name", not "/name").',
      'Inside a template, {"@call":"@index"} gives the position of the item, from 0. To count from 1, write {"@call":"@index","args":{"offset":1}}.',
    );
  }
  rules.push(
    "Updating a component replaces all of its props. Send every prop again.",
    "To change a surface in this reply, write another fence with the same surfaceId. Do not send createSurface again. The surface changes where it already is. A surface in a target can also be changed from a later reply; a chat surface cannot, because the chat is a transcript: a later reply with the same surfaceId makes a new surface.",
    "Use a new surfaceId for a different view. Never use a surfaceId again, also after the surface is deleted.",
  );
  if (functions) {
    rules.push(
      'To run an app function now, with no click, write a callRendererFunction line in a fence: {"version":"v1.0","callRendererFunction":{"functionCallId":"<unique id>","callFunction":{"@call":"<function>","args":{...}}}}. It needs no surface.',
      "Give every callRendererFunction a new functionCallId. Use only functions from the schema.",
      'The result of a callRendererFunction comes back to you as a developer message: {"version":"v1.0","rendererFunctionResponse":{"functionCallId":"<id>","value":...}}. If the call failed, it has "error" in place of "value". Then you get a new turn.',
      "Do not guess the result of a callRendererFunction. Wait for the developer message.",
    );
  }
  rules.push(...MARKDOWN_CLOSING_RULES);
  return `You can show interactive UI in your reply. Write A2UI operations inside a fenced code block tagged a2ui.

RULES
${rules.map((rule) => `- ${rule}`).join("\n")}
`;
}

/**
 * The markdown-transport guideline with every rule group. A run sends
 * `buildGenerativeUIMarkdownGuidelines` for its own manifest instead.
 */
export const GENERATIVE_UI_MARKDOWN_GUIDELINES =
  buildGenerativeUIMarkdownGuidelines();
