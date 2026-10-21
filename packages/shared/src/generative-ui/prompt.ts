import { generativeUIGuideFeatures } from "../a2ui-prompts";
import { functionCallers } from "./basic-functions";
import {
  GENERATIVE_UI_AGENT_FUNCTION_CALLS,
  GENERATIVE_UI_RENDER_TOOL,
} from "./types";
import type { GenerativeUIManifest } from "./types";

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

/**
 * The guide that the runtime adds as a context entry to a tool-transport run:
 * the `render_ui` rules, the targets, components, functions, and surfaces of
 * the manifest. It is in shared so that the inspector shows the same text.
 */
export function buildGenerativeUIPrompt(manifest: GenerativeUIManifest) {
  const targets = manifest.targets
    .map((t) => {
      const place =
        t.kind === "chat"
          ? "inside the chat transcript"
          : "a named area of the app";
      const limit = t.components
        ? `; only ${t.components.join(", ") || "no components"}`
        : "";
      const description = t.description ? `: ${t.description}` : "";
      return `- "${t.id}" (${place}${limit})${description}`;
    })
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
    .map(([name, f]) => {
      // A built-in function carries its short signature in the description
      // of its parameters; an app function has a JSON Schema.
      const signature = f.parameters.description;
      const args =
        typeof signature === "string" &&
        signature.startsWith("{") &&
        Object.keys(f.parameters).length === 2
          ? signature
          : JSON.stringify(f.parameters);
      // A function is for the UI unless marked: the agent calls only what
      // the mark allows.
      const callers = functionCallers(f);
      const who =
        callers.agent && GENERATIVE_UI_AGENT_FUNCTION_CALLS
          ? callers.renderer
            ? " (UI or agent)"
            : " (agent only)"
          : "";
      return `- **${name}**${who}${f.description ? `: ${f.description}` : ""}\n  args: ${args}`;
    })
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
    checks,
  } = generativeUIGuideFeatures(manifest);
  // The agent calls functions only while that path is on.
  const agentCalls = hasFunctions && GENERATIVE_UI_AGENT_FUNCTION_CALLS;
  const operations = [
    '{"version":"v1.0","createSurface":{"surfaceId":"<new id>","dataModel":{...},"components":[{"id":"root","component":"<Name>","children":["<child id>"]}]}}: the first operation of a new surface. "dataModel" and "components" are optional.',
    '{"version":"v1.0","updateComponents":{"surfaceId":"<id>","components":[<component>, ...]}}: add or replace components by id.',
    '{"version":"v1.0","updateDataModel":{"surfaceId":"<id>","path":"/some/path","value":<json>}}: set the value at "path". Always give "value". "value":null deletes the key at "path".',
    '{"version":"v1.0","deleteSurface":{"surfaceId":"<id>"}}: remove the surface.',
    ...(agentCalls
      ? [
          '{"version":"v1.0","callRendererFunction":{"functionCallId":"<unique id>","callFunction":{"@call":"<function>","args":{...}}}}: run an app function now, with no click. It needs no surface.',
        ]
      : []),
  ];
  const eventRule = hasFunctions
    ? 'Event props take an action. {"functionCall":{"@call":"<function>","args":{...}}} runs an app function in the browser immediately, and you are not told about it. {"event":{"name":"<name>","userMessage":"<text>","context":{...}}} sends the interaction back to you as a user message, with "userMessage" as its first line. "userMessage" is plain text: ${...} is not interpolated in it; put values in "context". Only call functions listed below.'
    : 'Event props take an action: {"event":{"name":"<name>","userMessage":"<text>","context":{...}}} sends the interaction back to you as a user message, with "userMessage" as its first line. "userMessage" is plain text: ${...} is not interpolated in it; put values in "context".';
  const rules = [
    'Components are flat objects: {"id":"...","component":"<Name>", ...props}. Every surface renders from the component with id "root". Reference children by id in slot props.',
    'A component may take "accessibility":{"label":"<1 to 3 words>","description":"<what it does>"} for screen readers: on the component it describes, when nothing visible names it. Not on every component, and "live":"polite" only on text that changes by itself.',
    'Stream progressively: put the initial data in "dataModel" and the root in "components" of the createSurface operation, then send one updateComponents operation per child, so the UI appears while you are still writing. The root must already list the ids of its children in its slot props (for example "children":["card-1","card-2"]), even though the children come later. A component that no slot references is never shown.',
    "Updating a component replaces all of its props, so resend every prop.",
    'Prop values are literals or data bindings {"@path":"/data/path"}. Never write {"path":"/data/path"} as a binding.',
    ...(events ? [eventRule] : []),
    "To show a different view, create a new surface with a new surfaceId (for example, a checkout form after a cart summary). Update an existing surface only when the user asks to change that same view: then do not send createSurface, use its surfaceId, and pass its existing target. Never reuse an earlier chat surface for a different view, because that replaces the earlier UI and anything the user typed into it.",
    "Never use a surfaceId again, also after deleteSurface.",
    'A prop can also be a function value that updates with the data: {"@call":"formatCurrency","args":{"value":{"@path":"/total"},"currency":"EUR"}}. Only call functions listed below. formatString interpolates ${/path} and ${fn(arg: value)} in its value.',
    'There are no operators in ${...} or in args. For arithmetic use calc, with the values as named args: {"@call":"calc","args":{"expression":"seats * 29 * (annual ? 0.8 : 1)","seats":{"@path":"/seats"},"annual":{"@path":"/annual"}}}. For a computed list (chart data) use series: {"@call":"series","args":{"count":12,"variable":"m","item":{"month":"${m}","cost":"${m * monthly}"},"monthly":{"@path":"/monthly"}}}.',
    ...(checks
      ? [
          'Validate an input with "checks": [{"condition":{"@call":"email","args":{"value":{"@path":"/form/email"}}},"message":"Enter a valid email"}]. The check functions are required, regex, length, numeric and email. A failed check shows the message under the input and disables a Button that has the same checks.',
        ]
      : []),
    ...(templates
      ? [
          'To repeat a component for each item of a list, give a multiple slot a template: "children":{"componentId":"row","path":"/items"}. Inside the template, paths are relative to the item ("name", not "/name"). {"@call":"@index"} gives the position of the item, from 0; {"@call":"@index","args":{"offset":1}} counts from 1.',
        ]
      : []),
    ...(agentCalls
      ? [
          "Give every callRendererFunction a new functionCallId. Call only a function marked (UI or agent) or (agent only); a function with no mark is for the UI only. A function marked (agent only) is only for callRendererFunction: do not bind an event to it.",
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
