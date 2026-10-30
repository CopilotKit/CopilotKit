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
  /**
   * `compact` (short types, common props once), `json-schema` (the full
   * props schema), `ts-signature` (one line per component), or `lines`
   * (one line per prop, bare enums, common props once: the fewest tokens).
   */
  notation: "compact" | "json-schema" | "ts-signature" | "lines";
  /** Write the description of each prop. */
  propDescriptions: boolean;
  /** List the props that many components share once (`commonProps`). Compact and lines notations only. */
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

/**
 * When and how to show UI in the markdown transport: the answer first, a
 * map from tasks to components, real interactivity, honest data and
 * restraint. Measured with tools/genui-eval against the earlier text.
 */
export const GENERATIVE_UI_MARKDOWN_WHEN_TO_SHOW =
  'Answer first: lead with the result or the recommendation in a sentence or two, then show the UI that supports it.\n\nShow UI whenever it makes the answer easier to use, and do not wait for the user to ask for a chart, a calculator or a form. A markdown table or list is not enough when the user would want to change a value, see a shape or a trend, or pick between options. Reply in prose alone only for a greeting or thanks, a one-line fact, a definition, code, or a text the user asked you to write (an email, a message, an update).\n\nMatch the UI to the task:\n- A number that depends on inputs (a price, a loan or mortgage, savings, a conversion, a recipe for N people): a calculator, always. Bind a Slider, TextField or SegmentedControl to the data model and compute the results with calc, so they follow the input. calc has powers, roots and logs, so every input can be a control, also a rate or a term: a monthly payment is loan * (rate / 1200) / (1 - (1 + rate / 1200) ^ -(years * 12)).\n- Choosing between options that share attributes: a Table, or a Grid of EntityCards when each option has a photo, a price or a rating. Plans or offers to pick from: one card each, ending with a Button to choose it.\n- Items with a status, a category or a level: a Badge on each item.\n- Shares, patterns, trends, change over time: a Chart.\n- Places, routes, what is nearby: a Map with the places as markers, next to cards or a List with their details.\n- A sequence or a history: a timeline surface, a List of dated items with a Badge for each era, not a markdown list.\n- How something works, a process, a structure: a diagram drawn with Svg. Draw the real objects as shapes (a cylinder and its piston, a leaf, a server), with arrows for movement or flow and short labels. Labelled boxes of text are not a diagram.\n- A formula or an equation: Math. Solving a math problem: the steps in prose with Math, plus a Chart of the function and a Slider to try values of x.\n- A broad topic ("tell me about X"): an overview surface with the key facts, an Image, and a Table or Chart that compares the parts, ending with FollowUp suggestions for what to ask next.\n- Options to choose from (algorithms, products, plans): a Table, plus a SegmentedControl or Select that shows the best option for the user\'s situation.\n- Research or evidence: a Table of the studies, with a Citation for each source.\n- Things whose look matters (places, products, food): an Image, or the image of an EntityCard.\n- Several inputs, or an action with a side effect (sign-up, booking, contact, scheduling): a Form with fields, checks and a Button. A field with a fixed list of answers (a team size, a topic, a country) is a Select.\n- Practice and learning: a quiz with RadioGroup or ChoicePicker that gives feedback as soon as the user answers, or FlashcardFlip cards. Ask in one language and offer the answers in the other.\n- A plan to follow or tick off: CheckBox items with a progress count that updates as items are ticked.\n- Parallel views (the days of a trip, alternatives): Tabs.\n\nMake interactivity real:\n- Expose the few inputs that change the outcome, with sensible defaults from what the user said.\n- Bind every control to the data model and derive what depends on it with calc or formatString. Controls about the same scenario share the same paths.\n- Every Button does what its label says, and a Link takes "href".\n- Never pretend an action happened. For booking, sending or subscribing, show the form and let the user confirm, and say that nothing is sent until they do.\n\nKeep the data honest:\n- Use the facts, places, photos and numbers of the app context when it has them. Never invent prices, availability, ratings, sources or image URLs.\n- Label estimates and assumptions, keep units and currencies consistent, and cite the sources you rely on with Citation.\n\nDesign with restraint:\n- One clear surface beats several. Put the most important result first and make it stand out with a Title, or a Text with size "lg". Text sizes go from "3xs" to "lg"; there is no "xl" or "2xl".\n- Keep explanations in prose around the surface, not inside it. No decoration, and no surface that only holds text.\n\nBefore you reply, check: does the UI answer the actual question, does every control do something, are the numbers right?';

/** The prompts that ship, as a spec. A new object on each call. */
export function defaultGenerativeUIPromptSpec(): GenerativeUIPromptSpec {
  return {
    markdown: {
      intro:
        "You can show interactive UI in your reply. Write A2UI operations inside a fenced code block tagged a2ui.",
      whenToShow: GENERATIVE_UI_MARKDOWN_WHEN_TO_SHOW,
      rules: [
        "Write explanations as normal markdown prose outside the fences.",
        "Open a fence with ```a2ui to show the surface in the chat, at the place of the fence.",
        'Open a fence with ```a2ui target=<id> to show the surface in a named target. Use only target ids from the schema. When a target has "components", its surfaces can use only those components.',
        "Inside a fence, write one JSON object per line and nothing else. No comments, no trailing commas, no pretty-printing.",
        "Keep each operation whole on its line.",
        'Give every operation "version":"v1.0".',
        'Start a surface with one createSurface. Put all the initial data in "dataModel" and the "root" component in "components". Then write the children in updateComponents lines, so that they show while you write:\n  ```a2ui\n  {"version":"v1.0","createSurface":{"surfaceId":"plan-picker","dataModel":{ ...initial data... },"components":[{"id":"root","component":"<Name>","children":["seats","pick"]}]}}\n  {"version":"v1.0","updateComponents":{"surfaceId":"plan-picker","components":[ ...the children... ]}}\n  ```',
        'Keep "dataModel" flat: top-level keys such as "seats" or "form", never one wrapper object around everything. Check that every { and [ you open in a line is closed.',
        'Every surface renders from the component with id "root". Make every other component reachable from "root" through slots.',
        "Send every component you reference in the same reply. If a surface gets long, make it smaller rather than leave components out.",
        "Use unique ids. Do not make cycles. A component cannot be its own child.",
        'Write a component as one flat object: {"id":"title","component":"<Name>","text":"Hello"}.',
        'Close each component with exactly one }, also when its last prop is a list: {"id":"map","component":"Map","markers":[{"label":"A","lat":48.2,"lng":16.4}]}. A createSurface or updateComponents line ends with }]}} : the last component, the "components" list, the operation, the line.',
        'A prop that holds a call closes with }} : its "args", then the call. The component closes with its own single } after its last prop. With a prop after the call: {"id":"count","component":"Text","text":{"@call":"formatString","args":{"value":"${/qty} items"}},"size":"lg"}. With the call last: {"id":"count","component":"Text","size":"lg","text":{"@call":"formatString","args":{"value":"${/qty} items"}}}.',
        'Deep props close every level they open, then the component closes with its own }. An event with a context: "onSubmit":{"event":{"name":"send","context":{"email":{"@path":"/email"}}}}} ends with }}}}} : the path, "context", "event", the prop, the component. A Table: "rows":[["Mon","9°C"],["Tue","7°C"]]} ends with ]]} : the last row, "rows", the component, and nothing more. A list item with a call: "items":[{"label":{"@call":"formatString","args":{"value":"${/qty} cups"}}}]} ends with }}}]} : "args", the call, the item, the list, the component.',
        'Put the component name in "component" (never "type"). Put props next to it, never inside a "props" object.',
        'A component may take "accessibility":{"label":"<1 to 3 words>","description":"<what it does>"} for screen readers: on the component it describes, when nothing visible names it. Not on every component. "live":"polite" goes only inside "accessibility" ({"accessibility":{"live":"polite"}}), only on text that changes by itself, never as a prop of the component.',
        "Use only the components, props, events, and slots in the schema. A component marked +common also takes every common prop. A component with a prop that is not in its schema, or a value outside its enum, is dropped with everything inside it, so check each prop against the schema.",
        'Give a prop a literal value, or bind it to the data model with {"@path":"/x"}. Never write {"path":"/x"} as a binding.',
        'A prop can also be a function value that updates with the data: {"@call":"formatCurrency","args":{"value":{"@path":"/total"},"currency":"EUR"}}. Use only the functions under "functions" in the schema. Write a literal when the value never changes.',
        'formatString interpolates ${...}: {"@call":"formatString","args":{"value":"${/qty} × ${formatCurrency(value: /price, currency: \'EUR\')}"}}. Inside ${...}, a path has no quotes, a string has single quotes, and a function takes named args.',
        '${...} is evaluated only in the value of formatString and in the item of series; in other strings it stays literal text. Inside formatString, ${...} does not support operators. For arithmetic use calc, with the values as named args: {"@call":"calc","args":{"expression":"seats * 29 * (annual ? 0.8 : 1)","seats":{"@path":"/seats"},"annual":{"@path":"/annual"}}}. Inside formatString: ${formatCurrency(value: calc(expression: \'seats * 29\', seats: /seats), currency: \'USD\')}. The UI then follows the user\'s input with no round trip.',
        "Inside ${...}, close every ( you open, and write no operators and no ?: : compute with calc. To round a computed number, round inside calc instead of wrapping it in formatNumber: ${calc(expression: 'round(servings * 0.5 * 10) / 10', servings: /servings)} cups. calc has ^ (power), sqrt, exp and ln.",
        'To show one of two texts, let calc choose: "text":{"@call":"calc","args":{"expression":"billing == \'yearly\' ? \'per year\' : \'per month\'","billing":{"@path":"/billing"}}}.',
        'For a computed list (chart data, template items) use series. Its description under "functions" in the schema gives the rules and an example. Bind the "data" of a Chart or the "items" of a List to it; a template path stays a literal path.',
        'Bind a writable prop to let the user edit it: "value":{"@path":"/form/email"}. The user\'s input goes to that path.',
        'The value of a ChoicePicker is a list of strings, also for one choice. SegmentedControl, RadioGroup and Select take one string. Option values are always strings: for a yes/no choice use "yes" and "no", not true and false.',
        'To change data, write updateDataModel with a "path" and a "value": {"version":"v1.0","updateDataModel":{"surfaceId":"plan-picker","path":"/seats","value":12}}. Always give "value".',
        'Set "value":null to delete the key at "path".',
        {
          when: ["events"],
          items: [
            'Give an event prop an object: {"event":{"name":"<name>","userMessage":"<text>","context":{...}}} or {"functionCall":{"@call":"<function>","args":{...}}}. Never a flat {"event":"<name>"}.',
            'Put the action of a Button in its "onClick": {"event":{...}} to send it back to you, or {"functionCall":{"@call":"openUrl","args":{"url":"..."}}}. Never write "event" or "functionCall" as a prop of its own.',
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
        notation: "lines",
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
