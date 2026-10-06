/** Normalize frontend context for the existing AG-UI generation/recovery tool. */
type Properties = Record<string, unknown>;

const isRecord = (value: unknown): value is Properties =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function merge(base: Properties, overrides: Properties): Properties {
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    result[key] =
      isRecord(result[key]) && isRecord(value)
        ? merge(result[key], value)
        : value;
  }
  return result;
}

function decode(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    // Catalog capability prose and usage guides are intentionally not JSON.
    return value;
  }
}

// Renderer catalogs use allOf for the common wire fields and component props.
// The toolkit currently reads top-level required/properties for validation.
function validationSchema(schema: Properties): Properties {
  const parts = Array.isArray(schema.allOf)
    ? schema.allOf.filter(isRecord).map(validationSchema)
    : [];
  return {
    ...schema,
    required: [
      ...new Set(
        [schema, ...parts].flatMap((part) =>
          Array.isArray(part.required)
            ? part.required.filter(
                (key): key is string => typeof key === "string",
              )
            : [],
        ),
      ),
    ],
    properties: Object.assign(
      {},
      ...parts.map((part) => part.properties),
      schema.properties,
    ),
  };
}

export function a2uiContext(state: Properties) {
  const properties = merge(
    isRecord(state["ag-ui"]) ? state["ag-ui"] : {},
    isRecord(state.copilotkit) ? state.copilotkit : {},
  );
  const context = decode(properties.context);
  const entries = Array.isArray(context) ? context.filter(isRecord) : [];
  const schemaEntry = entries.find(
    (entry) =>
      typeof entry.description === "string" &&
      entry.description.startsWith("A2UI Component Schema"),
  );
  const schema = decode(
    Object.hasOwn(properties, "a2ui_schema")
      ? properties.a2ui_schema
      : schemaEntry?.value,
  );
  const catalog =
    isRecord(schema) && isRecord(schema.components)
      ? {
          components: Object.fromEntries(
            Object.entries(schema.components)
              .filter((entry): entry is [string, Properties] =>
                isRecord(entry[1]),
              )
              .map(([name, component]) => [name, validationSchema(component)]),
          ),
        }
      : undefined;
  const prompt = entries
    .map(
      (entry) =>
        `${entry.description ?? ""}\n${typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value)}`,
    )
    .join("\n\n");
  return {
    properties,
    prompt,
    catalog,
    catalogId:
      isRecord(schema) && typeof schema.catalogId === "string"
        ? schema.catalogId
        : undefined,
    state: {
      ...state,
      "ag-ui": {
        ...properties,
        context: entries.filter((entry) => entry !== schemaEntry),
        a2ui_schema: isRecord(schema) ? JSON.stringify(schema) : schema,
      },
    },
  };
}
