import {
  GENERATIVE_UI_APP_STATE_PATH,
  GENERATIVE_UI_EVENT_TOOL,
  GENERATIVE_UI_RENDER_TOOL,
} from "@copilotkit/shared";
import type { GenerativeUIManifest } from "@copilotkit/shared";

export const GENERATIVE_UI_CONTEXT_DESCRIPTION =
  "Generative UI guide: available components, functions, targets, and how to call render_ui.";

export function buildGenerativeUIPrompt(
  manifest: GenerativeUIManifest,
): string {
  const targets = manifest.targets
    .map(
      (t) =>
        `- "${t.id}" (${t.kind === "chat" ? "inside the chat transcript" : "a named area of the app"})`,
    )
    .join("\n");
  const components = Object.entries(manifest.components)
    .map(([name, c]) => {
      const lines = [
        `- **${name}**${c.description ? `: ${c.description}` : ""}`,
        `  props: ${JSON.stringify(c.props)}`,
      ];
      if (c.events) lines.push(`  event props: ${JSON.stringify(c.events)}`);
      if (c.slots)
        lines.push(`  slot props (component ids): ${JSON.stringify(c.slots)}`);
      return lines.join("\n");
    })
    .join("\n");
  const functions = Object.entries(manifest.functions)
    .map(
      ([name, f]) =>
        `- **${name}**${f.description ? `: ${f.description}` : ""} — args: ${JSON.stringify(f.parameters)}`,
    )
    .join("\n");
  const appState = manifest.appState
    .map((key) => `- ${GENERATIVE_UI_APP_STATE_PATH}/${key}`)
    .join("\n");
  const surfaces = Object.entries(manifest.surfaces)
    .map(([id, s]) => `- "${id}" (target "${s.target}")`)
    .join("\n");

  return [
    `## Generative UI
Call \`${GENERATIVE_UI_RENDER_TOOL}\` to show UI. Arguments: \`target\` first, then \`operations\` (A2UI v0.9 messages applied in order).

Every operation has "version": "v0.9" and exactly one of:
- {"version":"v0.9","createSurface":{"surfaceId":"<new id>","catalogId":"${manifest.catalogId}"}} — first operation for a new surface.
- {"version":"v0.9","updateComponents":{"surfaceId":"<id>","components":[<component>, ...]}} — add or replace components by id.
- {"version":"v0.9","updateDataModel":{"surfaceId":"<id>","path":"/some/path","value":<json>}}
- {"version":"v0.9","deleteSurface":{"surfaceId":"<id>"}}

Rules:
1. Components are flat objects: {"id":"...","component":"<Name>", ...props}. Every surface renders from the component with id "root". Reference children by id in slot props.
2. Stream progressively: send the root in its own updateComponents operation first, then one updateComponents operation per child, so the UI appears while you are still writing. The root must already list the ids of its children in its slot props (for example "children":["card-1","card-2"]), even though the children come later. A component that no slot references is never shown.
3. Updating a component replaces all of its props, so resend every prop.
4. Prop values are literals or data bindings {"path":"/data/path"}.
5. Event props take an action. {"functionCall":{"call":"<function>","args":{...}}} runs an app function in the browser immediately, and you are not told about it. {"event":{"name":"<name>","context":{...}}} sends the interaction back to you. Only call functions listed below.
6. ${GENERATIVE_UI_APP_STATE_PATH} is maintained by the app and is read-only for you. Bind to it, e.g. {"path":"${GENERATIVE_UI_APP_STATE_PATH}/cart/count"}.
7. To show a different view, create a new surface with a new surfaceId (for example, a checkout form after a cart summary). Update an existing surface only when the user asks to change that same view: then do not send createSurface, use its surfaceId, and pass its existing target. Never reuse an earlier chat surface for a different view, because that replaces the earlier UI and anything the user typed into it.
8. If the conversation ends with a \`${GENERATIVE_UI_EVENT_TOOL}\` tool call and its result, that is the user interacting with the UI (for example clicking a button). Respond to that interaction.`,
    `### Targets\n${targets || "- none"}`,
    `### Components\n${components || "- none"}`,
    `### Functions\n${functions || "- none"}`,
    `### App state\n${appState || "- none"}`,
    `### Existing surfaces\n${surfaces || "- none"}`,
  ].join("\n\n");
}
