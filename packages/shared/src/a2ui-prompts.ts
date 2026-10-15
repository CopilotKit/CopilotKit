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

/**
 * Generation guidelines for A2UI markdown mode: the agent writes A2UI v0.9
 * operations inside ```a2ui fences, interleaved with normal markdown prose.
 * Shorter than the tool guideline on purpose; the component schema and the
 * design guidelines are sent separately.
 */
export const A2UI_MARKDOWN_GENERATION_GUIDELINES_DESCRIPTION =
  "A2UI markdown-mode generation guidelines — how to emit A2UI surfaces inside ```a2ui code fences in a normal markdown reply.";

/**
 * Description of the markdown-mode component-schema context entry.
 *
 * Deliberately different from `A2UI_SCHEMA_CONTEXT_DESCRIPTION` (the tool-mode
 * key stamped by `@ag-ui/a2ui-middleware`): the LangGraph and Strands adapters
 * recognise that exact string and route the entry into `state["ag-ui"]
 * ["a2ui_schema"]` for the `render_a2ui` tool instead of the system prompt.
 * Markdown mode has no tool, so the schema must stay ordinary context that
 * reaches the model as App Context.
 */
export const A2UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION =
  "A2UI markdown-mode component schema — the components and props the client can render inside ```a2ui code fences.";

export const A2UI_MARKDOWN_GENERATION_GUIDELINES = `\
You can render interactive UI inline in your reply by writing an A2UI surface inside a fenced code block tagged a2ui.

RULES
- Write normal markdown prose for explanations. Put UI in one or more fences:
  \`\`\`a2ui
  {"version":"v0.9","createSurface":{"surfaceId":"plan-estimator"}}
  {"version":"v0.9","updateComponents":{"surfaceId":"plan-estimator","components":[ ...components... ]}}
  {"version":"v0.9","updateDataModel":{"surfaceId":"plan-estimator","path":"/","value":{ ...initial data... }}}
  \`\`\`
- Inside the fence, write exactly one JSON object per line and nothing else. No comments, no trailing commas, no markdown. Keep each operation compact on a single line and do not pretty-print the components array; if you must wrap, keep each component object whole on its line.
- Write the createSurface line first, then updateComponents, then updateDataModel. Write the "root" component first in the components array, then its children, so the UI paints while you are still writing.
- Exactly one component must have id "root". Every other component must be reachable from root via child/children. IDs are unique. No cycles.
- Each component is one flat JSON object: {"id":"title","component":"Text","text":"Hello"}. The component name goes in "component" (never "type"); its properties sit next to it, not inside a "props" object.
- Do not use function calls ({"call": ...}): this catalog defines no functions. A value is a literal or a { "path": "..." } binding. Compute derived values (totals, prices) yourself and write them as literals or into the data model.
- The schema may list shared layout props once under "commonProps"; every component marked "includesCommonProps" accepts all of them in addition to its own props.
- Rely on the catalog defaults for spacing: do not set padding/gap on Card or Box unless the layout needs it; numeric spacing is in 4px steps (gap 4 = 16px). Put related controls in one Card with a Title and a Caption, and use Row for label/value pairs.
- ONLY use component names and properties from the Available Components schema. Property values are inline literals unless the schema lists a { "path": "..." } option for that property.
- Editable inputs bind to the data model: "value": { "path": "/form/email" }. Pre-fill via updateDataModel. A button or form collects values through its action context: "action": { "event": { "name": "submit", "context": { "email": { "path": "/form/email" } } } }.
- When a button should send a message back to you, put the text in the action context: "action": { "event": { "name": "choose", "context": { "message": "Show me the Team plan" } } }. A button without an action does nothing.
- To update a surface later in the same reply, write another fence with the same surfaceId; its operations are applied on top. Use a new surfaceId for a separate surface.
- Repeat a template per item with children: { "componentId": "row", "path": "/items" }; inside a template use relative paths ("name", not "/name").
- Keep surfaces focused: one task per surface, no clutter. Never wrap the whole reply in a fence; prose goes outside.
- Never make a surface that is only prose. Explanations, intros and summaries are normal markdown outside the fence. Inside a surface use Markdown only when it sits next to other components (a table cell, a card beside a chart).
- Do not start a surface with a title or introduction; write those as markdown before the fence. The surface begins with the first real component.

VISUAL STYLE (match a calm, native look)
- Structure: Use Card only for an interactive panel (controls, a form, a configurator). Tables, charts, lists and explanations go under a Title in a plain Column, separated by a Divider when needed. Never put every section in a Card. Never nest a Card inside a Card and never put border: true on a Box inside a Card; separate groups inside a Card with Divider or plain gap.
- Palette: text uses color "default" or "secondary" only. Do not set background on Card, Box or Column, except at most one summary panel per Card using background "surface-secondary". Use colors like "success"/"danger"/"warning" only on Badge for a status, never for decoration.
- Hierarchy: at most one Title with size "2xl" per surface (the page heading), "lg" for section headings, Text size "md" for content, Caption for hints. Avoid Badge, Icon and emphasis unless they carry information.
- Rows: label/value pairs are a Row with justify "between" (Caption on the left, Text with weight "medium" on the right). Buttons go in a Row at the bottom of a Card; one primary Button, the rest variant "ghost".
- Tables: use Table with "columns" and "rows"; to put a Badge or Button in a cell write { "componentId": "<id>" } as the cell value and define that component in the same components array. Put action Buttons for each row either in a cell or in a Row under the table.
- Spacing: rely on defaults (gap 4 between sections, Card padding default). Do not add Spacer or extra padding to compensate.`;
