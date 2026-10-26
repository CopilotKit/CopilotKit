import {
  GENERATIVE_UI_AGENT_FUNCTION_CALLS,
  GENERATIVE_UI_RENDER_TOOL,
} from "./types";

/**
 * A condition of a prompt block. A block is in the prompt when every one of
 * its features holds for the manifest of the run.
 * - `functions` / `noFunctions`: the app mounts a function, or none.
 * - `events`, `templates`, `checks`: a component has an event prop, a
 *   multiple slot, or a "checks" prop.
 * - `agentCalls`: the agent may call renderer functions (`functions` and
 *   `GENERATIVE_UI_AGENT_FUNCTION_CALLS`).
 */
export type GenerativeUIPromptFeature =
  | "functions"
  | "noFunctions"
  | "events"
  | "templates"
  | "checks"
  | "agentCalls";

/** One rule, or a block of rules that is in the prompt only when its features hold. */
export type GenerativeUIPromptItem =
  | string
  | { when: GenerativeUIPromptFeature[]; items: string[] };

/** The instruction text of one transport. */
export interface GenerativeUIPromptSection {
  /** The first line. */
  intro: string;
  /** When UI helps. An empty string leaves the paragraph out. */
  whenToShow: string;
  /** The operations (tool transport only). */
  operations?: GenerativeUIPromptItem[];
  /** The rules, in order. */
  rules: GenerativeUIPromptItem[];
}

/** How the component schema is written. */
export interface GenerativeUISchemaSettings {
  /** `compact` (short types, common props once), `json-schema` (the full props schema), or `ts-signature` (one line per component). */
  notation: "compact" | "json-schema" | "ts-signature";
  /** Write the description of each prop. */
  propDescriptions: boolean;
  /** List the props that many components share once (`commonProps`). Compact notation only. */
  commonProps: boolean;
}

/**
 * Everything in the generative UI prompts that is wording, not protocol: the
 * instruction text of both transports, how the component schema is
 * written, and replacement descriptions for components and props
 * (`"DateTimeInput"`, `"DateTimeInput.timeStep"`). The builders take a spec;
 * without one they use `defaultGenerativeUIPromptSpec()`, which renders the
 * prompts that ship. The descriptions are applied to the manifest by the
 * caller (`applyDescriptionOverrides`), because the schema is built from it.
 */
export interface GenerativeUIPromptSpec {
  markdown: GenerativeUIPromptSection;
  tool: GenerativeUIPromptSection;
  schema: {
    markdown: GenerativeUISchemaSettings;
    tool: GenerativeUISchemaSettings;
  };
  descriptions: Record<string, string>;
}

/**
 * When UI helps the user, for both transports: a light nudge to reach for UI
 * where it conveys the answer better than prose, and to stay in prose
 * otherwise.
 */
export const GENERATIVE_UI_WHEN_TO_SHOW =
  "Show UI when it conveys the answer better than prose: to illustrate a concept (a diagram, a chart of how something changes), to compare options side by side, to let the user explore or adjust values, or to collect input. A small, focused surface next to your explanation often lands better than a long description. Reply in prose alone for a quick fact, a short answer, or conversation, and never add UI only as decoration.";

/** The prompts that ship, as a spec. A new object on each call. */
export function defaultGenerativeUIPromptSpec(): GenerativeUIPromptSpec {
  return {
    markdown: {
      intro:
        "You can show interactive UI in your reply. Write A2UI operations inside a fenced code block tagged a2ui.",
      whenToShow: GENERATIVE_UI_WHEN_TO_SHOW,
      rules: [
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
        'Keep "dataModel" flat: top-level keys such as "seats" or "form", never one wrapper object around everything. Check that every { and [ you open in a line is closed.',
        'Every surface renders from the component with id "root". Make every other component reachable from "root" through slots.',
        "Use unique ids. Do not make cycles. A component cannot be its own child.",
        'Write a component as one flat object: {"id":"title","component":"<Name>","text":"Hello"}.',
        'Put the component name in "component" (never "type"). Put props next to it, never inside a "props" object.',
        'A component may take "accessibility":{"label":"<1 to 3 words>","description":"<what it does>"} for screen readers: on the component it describes, when nothing visible names it. Not on every component, and "live":"polite" only on text that changes by itself.',
        'Use only the components, props, events, and slots in the schema. A component with "includesCommonProps" also takes every prop in "commonProps".',
        'Give a prop a literal value, or bind it to the data model with {"@path":"/x"}. Never write {"path":"/x"} as a binding.',
        'A prop can also be a function value that updates with the data: {"@call":"formatCurrency","args":{"value":{"@path":"/total"},"currency":"EUR"}}. Use only the functions under "functions" in the schema. Write a literal when the value never changes.',
        'formatString interpolates ${...}: {"@call":"formatString","args":{"value":"${/qty} × ${formatCurrency(value: /price, currency: \'EUR\')}"}}. Inside ${...}, a path has no quotes, a string has single quotes, and a function takes named args.',
        '${...} is evaluated only in the value of formatString and in the item of series; in other strings it stays literal text. Inside formatString, ${...} does not support operators. For arithmetic use calc, with the values as named args: {"@call":"calc","args":{"expression":"seats * 29 * (annual ? 0.8 : 1)","seats":{"@path":"/seats"},"annual":{"@path":"/annual"}}}. Inside formatString: ${formatCurrency(value: calc(expression: \'seats * 29\', seats: /seats), currency: \'USD\')}. The UI then follows the user\'s input with no round trip.',
        'For a computed list (chart data, template items) use series. Its description under "functions" in the schema gives the rules and an example. Bind the "data" of a Chart or the "items" of a List to it; a template path stays a literal path.',
        'Bind a writable prop to let the user edit it: "value":{"@path":"/form/email"}. The user\'s input goes to that path.',
        'To change data, write updateDataModel with a "path" and a "value": {"version":"v1.0","updateDataModel":{"surfaceId":"plan-picker","path":"/seats","value":12}}. Always give "value".',
        'Set "value":null to delete the key at "path".',
        {
          when: ["events"],
          items: [
            'Give an event prop an object: {"event":{"name":"<name>","userMessage":"<text>","context":{...}}} or {"functionCall":{"@call":"<function>","args":{...}}}. Never a flat {"event":"<name>"}.',
          ],
        },
        {
          when: ["events", "functions"],
          items: [
            'Use {"functionCall": ...} to run a function in the browser when the user clicks: an app function from the schema, or openUrl: {"functionCall":{"@call":"openUrl","args":{"url":"https://example.com"}}}. You are not told about the call.',
          ],
        },
        {
          when: ["events", "noFunctions"],
          items: [
            'Use {"functionCall": ...} to open a URL when the user clicks: {"functionCall":{"@call":"openUrl","args":{"url":"https://example.com"}}}. You are not told about the call.',
          ],
        },
        {
          when: ["events"],
          items: [
            'Use {"event": ...} to send the interaction back to you as a user message. Put the text of that message in "userMessage": {"event":{"name":"choose","userMessage":"Show me the Team plan"}}. "userMessage" is plain text: ${...} is not interpolated in it; put values in "context".',
            'To send input values with an event, bind them in the context: "context":{"email":{"@path":"/form/email"}}.',
            "A button or other event prop without an event or functionCall does nothing.",
          ],
        },
        {
          when: ["checks"],
          items: [
            'Validate an input with "checks": [{"condition":{"@call":"email","args":{"value":{"@path":"/form/email"}}},"message":"Enter a valid email"}]. The check functions are required, regex, length, numeric and email; a condition can also be a boolean {"@path"}. A failed check shows the message under the input and disables a Button that has the same checks.',
          ],
        },
        'A prop typed componentId takes the id of another component, and a childList takes ids ["a","b"]: "child":"card", "children":["a","b"], "tabs":[{"title":"Specs","child":"specs"}].',
        {
          when: ["templates"],
          items: [
            'To repeat a component for each item of a list, give a childList a template: "children":{"componentId":"row","path":"/items"}.',
            'Inside a template, paths are relative to the item ("name", not "/name").',
            'Inside a template, {"@call":"@index"} gives the position of the item, from 0. To count from 1, write {"@call":"@index","args":{"offset":1}}.',
          ],
        },
        "Updating a component replaces all of its props. Send every prop again.",
        "To change a surface in this reply, write another fence with the same surfaceId. Do not send createSurface again. The surface changes where it already is. A surface in a target can also be changed from a later reply; a chat surface cannot, because the chat is a transcript: a later reply with the same surfaceId makes a new surface.",
        "Use a new surfaceId for a different view. Never use a surfaceId again, also after the surface is deleted.",
        {
          when: ["agentCalls"],
          items: [
            'To run an app function now, with no click, write a callRendererFunction line in a fence: {"version":"v1.0","callRendererFunction":{"functionCallId":"<unique id>","callFunction":{"@call":"<function>","args":{...}}}}. It needs no surface.',
            'Give every callRendererFunction a new functionCallId. Call only a function from the schema with "callers": "UI or agent" or "agent only"; a function without "callers" is for the UI only. A function with "callers": "agent only" is only for callRendererFunction: do not bind an event to it.',
            'The result of a callRendererFunction comes back to you as a developer message: {"version":"v1.0","rendererFunctionResponse":{"functionCallId":"<id>","value":...}}. If the call failed, it has "error" in place of "value". Then you get a new turn.',
            "Do not guess the result of a callRendererFunction. Wait for the developer message.",
          ],
        },
        'The schema lists the surfaces that already exist under "surfaces". "dataModel" holds the values that the user entered: read them, and do not write those paths. "rejected" lists operations that the client dropped: send corrected operations in a new fence for that surfaceId. "status":"deleted" means the surface is gone: never use its id again. "status":"failed" means its createSurface was rejected: send a corrected createSurface with that id.',
        "Never make a surface that is only prose. Write headings, paragraphs, lists of text, intros, and summaries as markdown outside the fences, also between two fences.",
        "Put in a fence only what markdown cannot show: charts, tables, maps, images, badges, inputs, buttons, cards with controls.",
        "Use Card only for an interactive panel (controls, a form, a configurator). Put everything else in a plain layout component.",
        "Never wrap the whole reply in a fence.",
      ],
    },
    tool: {
      intro: `Call \`${GENERATIVE_UI_RENDER_TOOL}\` to show UI. Arguments: \`target\` first, then \`operations\` (A2UI v1.0 operations, applied in order).`,
      whenToShow: GENERATIVE_UI_WHEN_TO_SHOW,
      operations: [
        '{"version":"v1.0","createSurface":{"surfaceId":"<new id>","dataModel":{...},"components":[{"id":"root","component":"<Name>","children":["<child id>"]}]}}: the first operation of a new surface. "dataModel" and "components" are optional.',
        '{"version":"v1.0","updateComponents":{"surfaceId":"<id>","components":[<component>, ...]}}: add or replace components by id.',
        '{"version":"v1.0","updateDataModel":{"surfaceId":"<id>","path":"/some/path","value":<json>}}: set the value at "path". Always give "value". "value":null deletes the key at "path".',
        '{"version":"v1.0","deleteSurface":{"surfaceId":"<id>"}}: remove the surface.',
        {
          when: ["agentCalls"],
          items: [
            '{"version":"v1.0","callRendererFunction":{"functionCallId":"<unique id>","callFunction":{"@call":"<function>","args":{...}}}}: run an app function now, with no click. It needs no surface.',
          ],
        },
      ],
      rules: [
        'Components are flat objects: {"id":"...","component":"<Name>", ...props}. Every surface renders from the component with id "root". Reference children by id in slot props.',
        'A component may take "accessibility":{"label":"<1 to 3 words>","description":"<what it does>"} for screen readers: on the component it describes, when nothing visible names it. Not on every component, and "live":"polite" only on text that changes by itself.',
        'Stream progressively: put the initial data in "dataModel" and the root in "components" of the createSurface operation, then send one updateComponents operation per child, so the UI appears while you are still writing. The root must already list the ids of its children in its slot props (for example "children":["card-1","card-2"]), even though the children come later. A component that no slot references is never shown.',
        "Updating a component replaces all of its props, so resend every prop.",
        'Prop values are literals or data bindings {"@path":"/data/path"}. Never write {"path":"/data/path"} as a binding.',
        {
          when: ["events", "functions"],
          items: [
            'Event props take an action. {"functionCall":{"@call":"<function>","args":{...}}} runs an app function in the browser immediately, and you are not told about it. {"event":{"name":"<name>","userMessage":"<text>","context":{...}}} sends the interaction back to you as a user message, with "userMessage" as its first line. "userMessage" is plain text: ${...} is not interpolated in it; put values in "context". Only call functions listed below.',
          ],
        },
        {
          when: ["events", "noFunctions"],
          items: [
            'Event props take an action: {"event":{"name":"<name>","userMessage":"<text>","context":{...}}} sends the interaction back to you as a user message, with "userMessage" as its first line. "userMessage" is plain text: ${...} is not interpolated in it; put values in "context".',
          ],
        },
        "To show a different view, create a new surface with a new surfaceId (for example, a checkout form after a cart summary). Update an existing surface only when the user asks to change that same view: then do not send createSurface, use its surfaceId, and pass its existing target. Never reuse an earlier chat surface for a different view, because that replaces the earlier UI and anything the user typed into it.",
        "Never use a surfaceId again, also after deleteSurface.",
        'A prop can also be a function value that updates with the data: {"@call":"formatCurrency","args":{"value":{"@path":"/total"},"currency":"EUR"}}. Only call functions listed below. formatString interpolates ${/path} and ${fn(arg: value)} in its value.',
        '${...} is evaluated only in the value of formatString and in the item of series; in other strings it stays literal text. Inside formatString, ${...} does not support operators. For arithmetic use calc, with the values as named args: {"@call":"calc","args":{"expression":"seats * 29 * (annual ? 0.8 : 1)","seats":{"@path":"/seats"},"annual":{"@path":"/annual"}}}.',
        "For a computed list (chart data, template items) use series. Its description under Functions gives the rules and an example.",
        {
          when: ["checks"],
          items: [
            'Validate an input with "checks": [{"condition":{"@call":"email","args":{"value":{"@path":"/form/email"}}},"message":"Enter a valid email"}]. The check functions are required, regex, length, numeric and email. A failed check shows the message under the input and disables a Button that has the same checks.',
          ],
        },
        {
          when: ["templates"],
          items: [
            'To repeat a component for each item of a list, give a multiple slot a template: "children":{"componentId":"row","path":"/items"}. Inside the template, paths are relative to the item ("name", not "/name"). {"@call":"@index"} gives the position of the item, from 0; {"@call":"@index","args":{"offset":1}} counts from 1.',
          ],
        },
        {
          when: ["agentCalls"],
          items: [
            "Give every callRendererFunction a new functionCallId. Call only a function marked (UI or agent) or (agent only); a function with no mark is for the UI only. A function marked (agent only) is only for callRendererFunction: do not bind an event to it.",
            'The result of a callRendererFunction comes back to you in a new turn, as a developer message: {"version":"v1.0","rendererFunctionResponse":{"functionCallId":"<id>","value":...}}. If the call failed, it has "error" in place of "value". Do not wait for the result in this reply, and do not guess it.',
          ],
        },
      ],
    },
    schema: {
      markdown: {
        notation: "compact",
        propDescriptions: true,
        commonProps: true,
      },
      tool: {
        notation: "json-schema",
        propDescriptions: true,
        commonProps: false,
      },
    },
    descriptions: {},
  };
}

/** Which features hold for a run. */
export type GenerativeUIPromptFeatures = Record<
  GenerativeUIPromptFeature,
  boolean
>;

/** The rules of `items` whose block conditions hold, in order. */
export function selectPromptItems(
  items: readonly GenerativeUIPromptItem[],
  features: GenerativeUIPromptFeatures,
): string[] {
  return items.flatMap((item) =>
    typeof item === "string"
      ? [item]
      : item.when.every((feature) => features[feature])
        ? item.items
        : [],
  );
}

/**
 * The prompt features of a run, from the guide features of its manifest
 * (`generativeUIGuideFeatures`).
 */
export function generativeUIPromptFeatures(guide: {
  functions: boolean;
  events: boolean;
  templates: boolean;
  checks: boolean;
}): GenerativeUIPromptFeatures {
  return {
    functions: guide.functions,
    noFunctions: !guide.functions,
    events: guide.events,
    templates: guide.templates,
    checks: guide.checks,
    agentCalls: guide.functions && GENERATIVE_UI_AGENT_FUNCTION_CALLS,
  };
}
