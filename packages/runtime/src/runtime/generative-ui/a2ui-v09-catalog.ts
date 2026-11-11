/**
 * The A2UI v0.9 catalog context for an agent that speaks v0.9.
 *
 * The client renders A2UI 1.0 only and sends its catalog in the run envelope
 * (`forwardedProps.copilotkit.ui`). A v0.9 agent still calls `render_a2ui`
 * (injected by `A2UIMiddleware`) and must be told the components in v0.9
 * terms. The removed v0.9 client (`@copilotkit/a2ui-renderer`) sent that as
 * agent context; this module builds the same entries on the server, from the
 * 1.0 manifest.
 */
import type { RunAgentInput } from "@ag-ui/client";
import { A2UI_SCHEMA_CONTEXT_DESCRIPTION } from "@ag-ui/a2ui-middleware";
import {
  A2UI_BASIC_FUNCTIONS,
  A2UI_DEFAULT_DESIGN_GUIDELINES,
  A2UI_DEFAULT_GENERATION_GUIDELINES,
  childRefKind,
  envelopeToManifest,
  functionCallers,
  readCopilotKitUIEnvelope,
} from "@copilotkit/shared";
import type {
  GenerativeUIComponentManifest,
  GenerativeUIFunctionManifest,
} from "@copilotkit/shared";
import {
  STANDARD_CATALOG_ID,
  argsSchemaFromSignature,
  standardDeclarations,
} from "@copilotkit/shared/generative-ui";

/** Id of the A2UI v0.9 basic catalog. */
const A2UI_V09_BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

// The description strings of the context entries, as the v0.9 client sent
// them (`@copilotkit/a2ui-renderer` `catalog-context.ts`). Agents and the
// middleware find the entries by them. The schema description comes from
// `@ag-ui/a2ui-middleware`, which looks it up and can replace the entry.
const CAPABILITIES_CONTEXT_DESCRIPTION =
  "A2UI catalog capabilities: available catalog IDs and custom component definitions the client can render.";
const GENERATION_GUIDELINES_CONTEXT_DESCRIPTION =
  "A2UI generation guidelines — protocol rules, tool arguments, path rules, data model format, and form/two-way-binding instructions.";
const DESIGN_GUIDELINES_CONTEXT_DESCRIPTION =
  "A2UI design guidelines — visual design rules, component hierarchy tips, and action handler patterns.";

/** The components of the v0.9 basic catalog. The 1.0 standard catalog has each of them. */
const V09_BASIC_COMPONENTS: ReadonlySet<string> = new Set([
  "Text",
  "Image",
  "Icon",
  "Video",
  "AudioPlayer",
  "Row",
  "Column",
  "List",
  "Card",
  "Tabs",
  "Modal",
  "Divider",
  "Button",
  "TextField",
  "CheckBox",
  "ChoicePicker",
  "Slider",
  "DateTimeInput",
]);

/**
 * The props (and events and slots) of standard components that v0.9 names
 * differently: component → 1.0 name → v0.9 name. Every other prop has the
 * same name in both versions.
 */
const V10_TO_V09_PROP_NAMES: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  Button: { onClick: "action" },
};

type JsonSchema = Record<string, unknown>;

const COMMON = "common_types.json#/$defs/";
const ref = (name: string) => ({ $ref: `${COMMON}${name}` });

/**
 * The v0.9 common types the schemas reference, in their v0.9 shapes, so
 * every `common_types.json#/$defs/<Name>` ref resolves within the payload.
 */
const V09_COMMON_TYPES: Record<string, JsonSchema> = {
  ComponentId: {
    type: "string",
    description:
      "The unique identifier for a component, used for both definitions and references within the same surface.",
  },
  ComponentCommon: {
    type: "object",
    properties: {
      id: ref("ComponentId"),
      accessibility: ref("AccessibilityAttributes"),
    },
    required: ["id"],
  },
  AccessibilityAttributes: {
    type: "object",
    description:
      "Attributes to enhance accessibility when using assistive technologies like screen readers.",
    properties: {
      label: ref("DynamicString"),
      description: ref("DynamicString"),
    },
  },
  ChildList: {
    oneOf: [
      {
        type: "array",
        items: ref("ComponentId"),
        description: "A static list of child component IDs.",
      },
      {
        type: "object",
        description:
          "A template for generating a dynamic list of children from a data model list. The `componentId` is the component to use as a template.",
        properties: {
          componentId: ref("ComponentId"),
          path: {
            type: "string",
            description:
              "The path to the list of component property objects in the data model.",
          },
        },
        required: ["componentId", "path"],
        additionalProperties: false,
      },
    ],
  },
  DataBinding: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "A JSON Pointer path to a value in the data model.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  FunctionCall: {
    type: "object",
    description: "Invokes a named function on the client.",
    properties: {
      call: {
        type: "string",
        description: "The name of the function to call.",
      },
      args: {
        type: "object",
        description: "Arguments passed to the function.",
        additionalProperties: ref("DynamicValue"),
      },
    },
    required: ["call"],
    additionalProperties: false,
  },
  DynamicValue: {
    description:
      "A value that can be a literal, a path, or a function call returning any type.",
    anyOf: [
      { type: "string" },
      { type: "number" },
      { type: "boolean" },
      { type: "array" },
      ref("DataBinding"),
      ref("FunctionCall"),
    ],
  },
  DynamicString: {
    anyOf: [{ type: "string" }, ref("DataBinding"), ref("FunctionCall")],
  },
  DynamicNumber: {
    anyOf: [{ type: "number" }, ref("DataBinding"), ref("FunctionCall")],
  },
  DynamicBoolean: {
    anyOf: [{ type: "boolean" }, ref("DataBinding"), ref("FunctionCall")],
  },
  DynamicStringList: {
    anyOf: [
      { type: "array", items: { type: "string" } },
      ref("DataBinding"),
      ref("FunctionCall"),
    ],
  },
  Action: {
    description:
      "Defines an interaction handler that can either trigger a server-side event or execute a local client-side function.",
    oneOf: [
      {
        type: "object",
        description: "Triggers a server-side event.",
        properties: {
          event: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description:
                  "The name of the action to be dispatched to the server.",
              },
              context: {
                type: "object",
                description:
                  "A JSON object containing the key-value pairs for the action context. Values can be literals or paths.",
                additionalProperties: ref("DynamicValue"),
              },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
        required: ["event"],
        additionalProperties: false,
      },
      {
        type: "object",
        description: "Executes a local client-side function.",
        properties: { functionCall: ref("FunctionCall") },
        required: ["functionCall"],
        additionalProperties: false,
      },
    ],
  },
};

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 1.0 binding and call syntax in a description, written the v0.9 way. */
function v09Text(text: string) {
  return text.replaceAll('"@path"', '"path"').replaceAll('"@call"', '"call"');
}

/** The v0.9 dynamic type of a literal schema that is just a primitive type. */
const DYNAMIC_TYPES: Readonly<Record<string, string>> = {
  string: "DynamicString",
  number: "DynamicNumber",
  boolean: "DynamicBoolean",
};

/**
 * A prop value as v0.9 states it: its literal schema, a `{ path }` binding
 * or a `{ call }` function call. A plain string, number, boolean or string
 * list is the v0.9 `Dynamic*` type of the same meaning. A component
 * reference stays one.
 *
 * Only the prop itself is made dynamic, as in the v0.9 basic catalog: the
 * 1.0 catalog marks every nested value dynamic too, which makes the
 * standard catalog several times larger.
 */
function dynamicValue(schema: unknown): JsonSchema {
  if (!isRecord(schema)) return ref("DynamicValue");
  const v09 = v09Schema(schema) as JsonSchema;
  if (childRefKind(schema)) return v09;
  const { description, ...literal } = v09;
  const text = typeof description === "string" ? { description } : {};
  const keys = Object.keys(literal);
  if (keys.length === 1 && typeof literal.type === "string") {
    const dynamic = DYNAMIC_TYPES[literal.type];
    if (dynamic) return { ...ref(dynamic), ...text };
  }
  const items = literal.items;
  if (
    keys.length === 2 &&
    literal.type === "array" &&
    isRecord(items) &&
    Object.keys(items).length === 1 &&
    items.type === "string"
  ) {
    return { ...ref("DynamicStringList"), ...text };
  }
  return { ...text, anyOf: [literal, ref("DataBinding"), ref("FunctionCall")] };
}

/** A copy of a schema, with its descriptions written the v0.9 way. */
function v09Schema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(v09Schema);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === "description" && typeof child === "string"
        ? v09Text(child)
        : v09Schema(child),
    ]),
  );
}

const mapValues = (
  record: JsonSchema,
  transform: (value: unknown) => unknown,
): JsonSchema =>
  Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, transform(value)]),
  );

/** An object schema with each of its properties made dynamic. */
function dynamicProperties(schema: JsonSchema): JsonSchema {
  const result = v09Schema(schema) as JsonSchema;
  if (isRecord(schema.properties)) {
    result.properties = mapValues(schema.properties, dynamicValue);
  }
  return result;
}

/**
 * Local refs (`#/...`) of a props schema, pointing to where the schema is
 * embedded in the payload instead of to the root of the props schema.
 */
function rebaseRefs(value: unknown, base: string): unknown {
  if (Array.isArray(value)) return value.map((item) => rebaseRefs(item, base));
  if (!isRecord(value)) return value;
  const result = mapValues(value, (child) => rebaseRefs(child, base));
  const target = result.$ref;
  if (target === "#") result.$ref = base;
  else if (typeof target === "string" && target.startsWith("#/")) {
    result.$ref = `${base}${target.slice(1)}`;
  }
  return result;
}

/** A JSON Pointer segment: `acme/Card` is `acme~1Card`. */
function pointerSegment(name: string) {
  return name.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * One component in the v0.9 inline catalog format: `ComponentCommon` and
 * the props, events and slots of the 1.0 manifest under their v0.9 names.
 */
function componentSchema(
  name: string,
  manifest: GenerativeUIComponentManifest,
  renames: Readonly<Record<string, string>>,
): JsonSchema {
  const v09Name = (key: string) => renames[key] ?? key;
  const { properties, required, description, $defs, definitions } =
    manifest.props;
  const fields: JsonSchema = {};
  for (const [key, schema] of Object.entries(
    isRecord(properties) ? properties : {},
  )) {
    fields[key] = dynamicValue(schema);
  }
  for (const [key, event] of Object.entries(manifest.events ?? {})) {
    fields[key] = {
      ...ref("Action"),
      ...(event.description ? { description: v09Text(event.description) } : {}),
    };
  }
  for (const [key, kind] of Object.entries(manifest.slots ?? {})) {
    fields[key] = ref(kind === "single" ? "ComponentId" : "ChildList");
  }
  const order = [...(manifest.parameterOrder ?? []), ...Object.keys(fields)];
  const ordered: JsonSchema = { component: { const: name } };
  for (const key of order) {
    if (Object.hasOwn(fields, key)) ordered[v09Name(key)] = fields[key];
  }
  // The definitions of the props schema, when its converter made some.
  const defs = {
    ...(isRecord($defs) ? { $defs: v09Schema($defs) } : {}),
    ...(isRecord(definitions) ? { definitions: v09Schema(definitions) } : {}),
  };
  const text = manifest.description ?? description;
  const body = rebaseRefs(
    {
      properties: ordered,
      required: [
        "component",
        ...(Array.isArray(required)
          ? required.filter((key) => typeof key === "string").map(v09Name)
          : []),
      ],
      ...defs,
    },
    `#/components/${pointerSegment(name)}/allOf/1`,
  ) as JsonSchema;
  return {
    ...(typeof text === "string" ? { description: v09Text(text) } : {}),
    allOf: [ref("ComponentCommon"), body],
  };
}

/** A function in the v0.9 inline catalog `functions` format. */
function functionSchema(
  name: string,
  description: string | undefined,
  returnType: string | undefined,
  parameters: JsonSchema,
) {
  return {
    name,
    ...(description ? { description: v09Text(description) } : {}),
    // v0.9 has no `validationResult`: its checks are boolean function calls.
    returnType:
      returnType === "validationResult" ? "boolean" : (returnType ?? "any"),
    parameters,
  };
}

/**
 * The functions a v0.9 `{ call }` may name: the basic ones, which v0.9 names
 * the same, then the app functions the renderer may call.
 */
function catalogFunctions(
  functions: Record<string, GenerativeUIFunctionManifest>,
) {
  const result = Object.entries(A2UI_BASIC_FUNCTIONS)
    .filter(([name]) => !Object.hasOwn(functions, name))
    .map(([name, info]) =>
      functionSchema(
        name,
        info.description,
        info.returnType,
        argsSchemaFromSignature(info.parameters),
      ),
    );
  for (const [name, fn] of Object.entries(functions)) {
    if (!functionCallers(fn).renderer) continue;
    result.push(
      functionSchema(
        name,
        fn.description,
        fn.returnType,
        dynamicProperties(fn.parameters),
      ),
    );
  }
  return result;
}

/**
 * The capabilities entry: the catalog id, then the components beyond the
 * v0.9 basic catalog, by name. Their schemas are in the schema entry, so
 * they are not repeated here.
 */
function capabilitiesValue(
  catalogId: string,
  names: readonly string[] | undefined,
) {
  const lines = ["Available A2UI catalog:"];
  if (names === undefined) {
    lines.push(`- ${catalogId}`);
    return lines.join("\n");
  }
  const extra = names.filter((name) => !V09_BASIC_COMPONENTS.has(name));
  const nameSet = new Set(names);
  const isSuperset = [...V09_BASIC_COMPONENTS].every((name) =>
    nameSet.has(name),
  );
  if (catalogId === A2UI_V09_BASIC_CATALOG_ID && isSuperset && !extra.length) {
    lines.push(`- ${catalogId} (basic catalog)`);
    return lines.join("\n");
  }
  lines.push(`- ${catalogId}`);
  if (isSuperset) {
    lines.push(
      "  Extends the basic catalog with all standard components plus:",
    );
  } else {
    lines.push("  Custom catalog (does NOT include all basic components).");
    lines.push("  Custom components:");
  }
  for (const name of extra) lines.push(`  - ${name}`);
  return lines.join("\n");
}

/**
 * Builds the A2UI v0.9 catalog context for a run, from the generative UI
 * envelope the client sent (`forwardedProps.copilotkit.ui`).
 *
 * The entries are the ones the v0.9 client sent, with the same descriptions:
 * the catalog capabilities, the component schema (the v0.9 inline catalog
 * format that `A2UIMiddleware` reads, and replaces when it has a server
 * schema), and the v0.9 generation and design guidelines. Without the
 * component schemas in the envelope, only the capabilities entry is built.
 *
 * The components are the v0.9 basic ones of the standard catalog and the
 * UI's own components: the other standard components (Title, Chart, ...)
 * are left out, as a v0.9 agent never knew them and they would make the
 * schema about three times larger. A component of the UI's own that has the
 * name of a standard component counts as the standard one.
 *
 * Components keep their names. Props, events and slots keep their 1.0 names
 * except for `V10_TO_V09_PROP_NAMES` on standard components;
 * values take a v0.9 `{ path }` binding or `{ call }` function call, events
 * take a v0.9 action, and slots a v0.9 `ComponentId` or `ChildList`.
 *
 * The catalog id is the v0.9 basic catalog id when the UI includes the 1.0
 * standard catalog, which has every v0.9 basic component: v0.9 agents and
 * prompts already use that id, and `A2UIMiddleware` stamps the id of the
 * schema entry into the surfaces it creates. Otherwise it is the id of the
 * UI, since the basic id would promise components the UI does not have.
 *
 * @param input - The run input.
 * @returns The catalog id the v0.9 agent should use and the context
 *   entries, or `undefined` when the run has no generative UI envelope.
 *
 * @example
 * ```ts
 * const v09 = buildA2UIV09CatalogContext(input);
 * if (v09) input = { ...input, context: [...input.context, ...v09.context] };
 * ```
 */
export function buildA2UIV09CatalogContext(input: RunAgentInput):
  | {
      catalogId: string;
      context: Array<{ description: string; value: string }>;
    }
  | undefined {
  const envelope = readCopilotKitUIEnvelope(input.forwardedProps);
  if (!envelope) return undefined;
  const manifest = envelopeToManifest(envelope);
  const extendsStandard = (
    manifest.catalogIds ?? [manifest.catalogId]
  ).includes(STANDARD_CATALOG_ID);
  const catalogId = extendsStandard
    ? A2UI_V09_BASIC_CATALOG_ID
    : manifest.catalogId;

  if (!manifest.hasComponents) {
    return {
      catalogId,
      context: [
        {
          description: CAPABILITIES_CONTEXT_DESCRIPTION,
          value: capabilitiesValue(catalogId, undefined),
        },
      ],
    };
  }

  const components: Record<string, JsonSchema> = {};
  for (const [name, component] of Object.entries(manifest.components)) {
    const isStandard =
      extendsStandard && Object.hasOwn(standardDeclarations, name);
    // Of the standard components, a v0.9 agent knows the basic ones only.
    if (isStandard && !V09_BASIC_COMPONENTS.has(name)) continue;
    const renames = (isStandard && V10_TO_V09_PROP_NAMES[name]) || {};
    components[name] = componentSchema(name, component, renames);
  }
  const schema = {
    catalogId,
    components,
    functions: catalogFunctions(manifest.functions),
    "common_types.json": { $defs: V09_COMMON_TYPES },
  };

  return {
    catalogId,
    context: [
      {
        description: CAPABILITIES_CONTEXT_DESCRIPTION,
        value: capabilitiesValue(catalogId, Object.keys(components)),
      },
      {
        description: A2UI_SCHEMA_CONTEXT_DESCRIPTION,
        value: JSON.stringify(schema),
      },
      {
        description: GENERATION_GUIDELINES_CONTEXT_DESCRIPTION,
        value: A2UI_DEFAULT_GENERATION_GUIDELINES,
      },
      {
        description: DESIGN_GUIDELINES_CONTEXT_DESCRIPTION,
        value: A2UI_DEFAULT_DESIGN_GUIDELINES,
      },
    ],
  };
}
