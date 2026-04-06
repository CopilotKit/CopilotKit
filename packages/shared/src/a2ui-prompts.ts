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

DATA MODEL:
The "data" key in the tool args is a plain JSON object that initializes the surface
data model. Components bound to paths (e.g. "value": { "path": "/form/name" })
read from and write to this data model. Examples:
  For forms:  "data": { "form": { "name": "Alice", "email": "" } }
  For lists:  "data": { "items": [{"name": "Product A"}, {"name": "Product B"}] }
  For mixed:  "data": { "form": { "query": "" }, "results": [...] }

FORMS AND TWO-WAY DATA BINDING:
To create editable forms, bind input components to data model paths using { "path": "..." }.
The client automatically writes user input back to the data model at the bound path.
CRITICAL: Using a literal value (e.g. "value": "") makes the field READ-ONLY.
You MUST use { "path": "..." } to make inputs editable.

Input components use "value" as the binding property:
  "value": { "path": "/form/fieldName" }

To retrieve form values when a button is clicked, include "context" with path references
in the button's action. Paths are resolved to their current values at click time:
  "action": { "event": { "name": "submit", "context": { "userName": { "path": "/form/name" } } } }

To pre-fill form values, pass initial data via the "data" tool argument:
  "data": { "form": { "name": "Markus" } }`;

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
- For forms: every input MUST use path binding on the "value" property
  (e.g. "value": { "path": "/form/name" }) to be editable. The submit button's
  action context MUST reference the same paths to capture the user's input.

Use the SAME surfaceId as the main surface. Match action names to button action event names.`;
