import {
  GENERATIVE_UI_RENDER_TOOL,
  generativeUIGuideFeatures,
} from "@copilotkit/shared";
import type { GenerativeUIManifest } from "@copilotkit/shared";

export const GENERATIVE_UI_CONTEXT_DESCRIPTION =
  "Generative UI guide: available components, functions, targets, and how to call render_ui.";

/** Most characters of the user values of one surface in the guide. */
const MAX_USER_VALUES_LENGTH = 500;

/** Cuts long text and marks the cut with "...". */
function shorten(text: string) {
  return text.length > MAX_USER_VALUES_LENGTH
    ? `${text.slice(0, MAX_USER_VALUES_LENGTH)}...`
    : text;
}

export function buildGenerativeUIPrompt(manifest: GenerativeUIManifest) {
  const targets = manifest.targets
    .map(
      (t) =>
        `- "${t.id}" (${t.kind === "chat" ? "inside the chat transcript" : "a named area of the app"})${t.description ? `: ${t.description}` : ""}`,
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
        `- **${name}**${f.description ? `: ${f.description}` : ""}\n  args: ${JSON.stringify(f.parameters)}`,
    )
    .join("\n");
  const surfaces = Object.entries(manifest.surfaces)
    .map(([id, s]) => {
      const lines = [`- "${id}" (target "${s.target}")`];
      if (s.dataModel) {
        lines.push(`  user values: ${shorten(JSON.stringify(s.dataModel))}`);
      }
      for (const rejection of s.rejected ?? []) {
        lines.push(`  rejected: ${rejection}`);
      }
      return lines.join("\n");
    })
    .join("\n");
  const hasSurfaceNotes = Object.values(manifest.surfaces).some(
    (s) => s.dataModel !== undefined || (s.rejected?.length ?? 0) > 0,
  );
  const surfaceNotes = hasSurfaceNotes
    ? "User values are what the user entered, by path. Your writes to those paths are ignored. Rejected operations were dropped: send them again with the problem fixed.\n"
    : "";

  // Rules for functions, events, and templates go only to runs whose manifest
  // has them, so the guide stays small.
  const {
    functions: hasFunctions,
    events,
    templates,
  } = generativeUIGuideFeatures(manifest);
  const operations = [
    '{"version":"v1.0","createSurface":{"surfaceId":"<new id>","dataModel":{...},"components":[{"id":"root","component":"<Name>","children":["<child id>"]}]}}: the first operation of a new surface. "dataModel" and "components" are optional.',
    '{"version":"v1.0","updateComponents":{"surfaceId":"<id>","components":[<component>, ...]}}: add or replace components by id.',
    '{"version":"v1.0","updateDataModel":{"surfaceId":"<id>","path":"/some/path","value":<json>}}: set the value at "path". Always give "value". "value":null deletes the key at "path".',
    '{"version":"v1.0","deleteSurface":{"surfaceId":"<id>"}}: remove the surface.',
    ...(hasFunctions
      ? [
          '{"version":"v1.0","callRendererFunction":{"functionCallId":"<unique id>","callFunction":{"@call":"<function>","args":{...}}}}: run an app function now, with no click. It needs no surface.',
        ]
      : []),
  ];
  const eventRule = hasFunctions
    ? 'Event props take an action. {"functionCall":{"@call":"<function>","args":{...}}} runs an app function in the browser immediately, and you are not told about it. {"event":{"name":"<name>","userMessage":"<text>","context":{...}}} sends the interaction back to you as a user message, with "userMessage" as its first line. Only call functions listed below.'
    : 'Event props take an action: {"event":{"name":"<name>","userMessage":"<text>","context":{...}}} sends the interaction back to you as a user message, with "userMessage" as its first line.';
  const rules = [
    'Components are flat objects: {"id":"...","component":"<Name>", ...props}. Every surface renders from the component with id "root". Reference children by id in slot props.',
    'Stream progressively: put the initial data in "dataModel" and the root in "components" of the createSurface operation, then send one updateComponents operation per child, so the UI appears while you are still writing. The root must already list the ids of its children in its slot props (for example "children":["card-1","card-2"]), even though the children come later. A component that no slot references is never shown.',
    "Updating a component replaces all of its props, so resend every prop.",
    'Prop values are literals or data bindings {"@path":"/data/path"}. Never write {"path":"/data/path"} as a binding.',
    ...(events ? [eventRule] : []),
    "To show a different view, create a new surface with a new surfaceId (for example, a checkout form after a cart summary). Update an existing surface only when the user asks to change that same view: then do not send createSurface, use its surfaceId, and pass its existing target. Never reuse an earlier chat surface for a different view, because that replaces the earlier UI and anything the user typed into it.",
    "Never use a surfaceId again, also after deleteSurface.",
    ...(templates
      ? [
          'To repeat a component for each item of a list, give a multiple slot a template: "children":{"componentId":"row","path":"/items"}. Inside the template, paths are relative to the item ("name", not "/name").',
          'Never put {"@call": ...} in a data prop. Compute derived values yourself. The only exception: inside a template, {"@call":"@index"} gives the position of the item, from 0. Write {"@call":"@index","args":{"offset":1}} to count from 1.',
        ]
      : [
          'Never put {"@call": ...} in a data prop. Compute derived values yourself.',
        ]),
    ...(hasFunctions
      ? [
          "Give every callRendererFunction a new functionCallId. Only call functions listed below.",
          'The result of a callRendererFunction comes back to you in a new turn, as a developer message: {"version":"v1.0","rendererFunctionResponse":{"functionCallId":"<id>","value":...}}. If the call failed, it has "error" in place of "value". Do not wait for the result in this reply, and do not guess it.',
        ]
      : []),
  ];

  return [
    `## Generative UI
Call \`${GENERATIVE_UI_RENDER_TOOL}\` to show UI. Arguments: \`target\` first, then \`operations\` (A2UI v1.0 operations, applied in order).

Every operation has "version":"v1.0" and exactly one of:
${operations.map((op) => `- ${op}`).join("\n")}

Rules:
${rules.map((rule, index) => `${index + 1}. ${rule}`).join("\n")}`,
    `### Targets\n${targets || "- none"}`,
    `### Components\n${components || "- none"}`,
    `### Functions\n${functions || "- none"}`,
    `### Existing surfaces\n${surfaceNotes}${surfaces || "- none"}`,
  ].join("\n\n");
}
