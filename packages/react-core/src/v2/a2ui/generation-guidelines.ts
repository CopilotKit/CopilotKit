import { A2UI_DEFAULT_GENERATION_GUIDELINES } from "@copilotkit/shared";

/** Native 1.0 tool guidance. Structural template paths retain their own syntax. */
const A2UI_V1_GENERATION_GUIDELINES = `Generate A2UI 1.0 JSON.

Call render_a2ui with a unique surfaceId, the required components array, and optional
root data object. Use only component names, properties and functions declared in
the supplied catalog. Match its protocolVersion, catalogId and schemas.

Every component has a unique id and a component type. Exactly one component has
id="root", the surface entry point. All other components must be reachable from
root through child/children; never reference the same component as its own child,
and never create a cycle.

Use literal values unless the property's catalog schema permits a dynamic value.
Native value binding uses { "@path": "/form/name" }. A plain property schema does
not accept a binding object. Pre-fill editable values via the data argument:
  "data": { "form": { "name": "Alice" } }
  "value": { "@path": "/form/name" }

Native function expressions use { "@call": "functionName", "args": { ... } },
with only the parameters declared by the catalog; do not add returnType.

REPEATING CONTENT uses a structural children format, distinct from value binding:
  children: { componentId: "card-id", path: "/items" }
The structural key remains path. Initialize its data array with real items before
expecting a visible list. Components inside a template use relative value bindings:
  "text": { "@path": "name" }
An absolute binding such as { "@path": "/name" } reads from the root instead.

Buttons send nested event actions, with bound context to capture edited values:
  "action": { "event": { "name": "submit", "context": { "name": { "@path": "/form/name" } } } }
Local function actions use { "functionCall": { "@call": "functionName", "args": { ... } } }.
Do not rename literal objects' path keys: only @path denotes native value binding.
Keep an existing surface's protocol and catalog when updating it; create a new
surface to use a different protocol.`;

/** Preserve legacy prompt text exactly unless the selected catalog opts into 1.0. */
export function a2uiGenerationGuidelines(protocolVersion?: string): string {
  return protocolVersion === "1.0"
    ? A2UI_V1_GENERATION_GUIDELINES
    : A2UI_DEFAULT_GENERATION_GUIDELINES;
}
