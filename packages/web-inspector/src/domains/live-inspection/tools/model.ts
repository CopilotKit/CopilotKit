import type { AbstractAgent } from "@ag-ui/client";
import type { InspectorToolDefinition, LiveInspectionState } from "../state.js";

export type ToolSource = Readonly<{
  tools?: ReadonlyArray<{
    name: string;
    description?: string;
    parameters?: unknown;
    agentId?: string;
  }>;
  agents: Readonly<Record<string, AbstractAgent>>;
}>;

export type ToolSchemaProperty = {
  name: string;
  type?: string;
  description?: string;
  required: boolean;
  defaultValue?: unknown;
  enum?: unknown[];
};

function objectProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return key in value ? Reflect.get(value, key) : undefined;
}

function schemaDescription(value: object): string | undefined {
  const direct = objectProperty(value, "description");
  if (typeof direct === "string" && direct) return direct;
  const tool = objectProperty(value, "tool");
  if (tool && typeof tool === "object") {
    const description = objectProperty(tool, "description");
    return typeof description === "string" ? description : undefined;
  }
  return undefined;
}

function schemaParameters(value: object): unknown {
  const direct = objectProperty(value, "parameters");
  if (direct !== undefined) return direct;
  const tool = objectProperty(value, "tool");
  return tool && typeof tool === "object"
    ? objectProperty(tool, "parameters")
    : undefined;
}

export function extractTools(source: ToolSource): InspectorToolDefinition[] {
  const tools: InspectorToolDefinition[] = [];
  for (const tool of source.tools ?? []) {
    tools.push({
      agentId: tool.agentId ?? "",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      type: "handler",
    });
  }
  for (const [agentId, agent] of Object.entries(source.agents)) {
    const handlers = objectProperty(agent, "toolHandlers");
    if (handlers && typeof handlers === "object") {
      for (const [name, handler] of Object.entries(handlers)) {
        if (!handler || typeof handler !== "object") continue;
        tools.push({
          agentId,
          name,
          description: schemaDescription(handler),
          parameters: schemaParameters(handler),
          type: "handler",
        });
      }
    }
    const renderers = objectProperty(agent, "toolRenderers");
    if (renderers && typeof renderers === "object") {
      for (const [name, renderer] of Object.entries(renderers)) {
        if (
          !renderer ||
          typeof renderer !== "object" ||
          tools.some((tool) => tool.agentId === agentId && tool.name === name)
        ) {
          continue;
        }
        tools.push({
          agentId,
          name,
          description: schemaDescription(renderer),
          parameters: schemaParameters(renderer),
          type: "renderer",
        });
      }
    }
  }
  return tools.sort((left, right) => {
    const agentComparison = left.agentId.localeCompare(right.agentId);
    return agentComparison || left.name.localeCompare(right.name);
  });
}

export function refreshToolsSnapshot(
  state: LiveInspectionState,
  source: ToolSource | null,
): boolean {
  if (!source) {
    const changed = state.cachedTools.length > 0;
    state.cachedTools = [];
    state.toolSignature = "";
    return changed;
  }
  const tools = extractTools(source);
  const signature = JSON.stringify(
    tools.map((tool) => ({
      agentId: tool.agentId,
      name: tool.name,
      type: tool.type,
      hasDescription: Boolean(tool.description),
      hasParameters: Boolean(tool.parameters),
    })),
  );
  if (signature === state.toolSignature) return false;
  state.toolSignature = signature;
  state.cachedTools = tools;
  return true;
}

function zodOptional(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const definition = objectProperty(schema, "_def");
  if (!definition || typeof definition !== "object") return false;
  const typeName = objectProperty(definition, "typeName");
  return (
    typeName === "ZodOptional" ||
    typeName === "ZodNullable" ||
    objectProperty(definition, "defaultValue") !== undefined
  );
}

function zodFieldInfo(
  schema: unknown,
): Omit<ToolSchemaProperty, "name" | "required"> {
  const info: Omit<ToolSchemaProperty, "name" | "required"> = {};
  if (!schema || typeof schema !== "object") return info;
  let definition = objectProperty(schema, "_def");
  if (!definition || typeof definition !== "object") return info;
  let typeName = objectProperty(definition, "typeName");
  while (
    typeName === "ZodOptional" ||
    typeName === "ZodNullable" ||
    typeName === "ZodDefault"
  ) {
    const defaultValue = objectProperty(definition, "defaultValue");
    if (typeName === "ZodDefault" && defaultValue !== undefined) {
      info.defaultValue =
        typeof defaultValue === "function" ? defaultValue() : defaultValue;
    }
    const inner = objectProperty(definition, "innerType");
    if (!inner || typeof inner !== "object") break;
    const nextDefinition = objectProperty(inner, "_def");
    if (!nextDefinition || typeof nextDefinition !== "object") break;
    definition = nextDefinition;
    typeName = objectProperty(definition, "typeName");
  }
  const description = objectProperty(definition, "description");
  info.description = typeof description === "string" ? description : undefined;
  const typeMap: Record<string, string> = {
    ZodString: "string",
    ZodNumber: "number",
    ZodBoolean: "boolean",
    ZodArray: "array",
    ZodObject: "object",
    ZodEnum: "enum",
    ZodLiteral: "literal",
    ZodUnion: "union",
    ZodAny: "any",
    ZodUnknown: "unknown",
  };
  if (typeof typeName === "string") {
    info.type = typeMap[typeName] ?? typeName.replace("Zod", "").toLowerCase();
  }
  const values = objectProperty(definition, "values");
  const value = objectProperty(definition, "value");
  if (typeName === "ZodEnum" && Array.isArray(values)) info.enum = values;
  else if (typeName === "ZodLiteral" && value !== undefined)
    info.enum = [value];
  return info;
}

export function extractSchemaInfo(parameters: unknown): ToolSchemaProperty[] {
  if (!parameters || typeof parameters !== "object") return [];
  const definition = objectProperty(parameters, "_def");
  if (definition && typeof definition === "object") {
    if (objectProperty(definition, "typeName") !== "ZodObject") return [];
    const rawShape = objectProperty(definition, "shape");
    const shape = typeof rawShape === "function" ? rawShape() : rawShape;
    if (!shape || typeof shape !== "object") return [];
    const requireFields =
      objectProperty(definition, "unknownKeys") === "strict" ||
      !objectProperty(definition, "catchall");
    return Object.entries(shape).map(([name, field]) => ({
      name,
      ...zodFieldInfo(field),
      required: requireFields && !zodOptional(field),
    }));
  }
  if (objectProperty(parameters, "type") !== "object") return [];
  const properties = objectProperty(parameters, "properties");
  if (!properties || typeof properties !== "object") return [];
  const requiredValue = objectProperty(parameters, "required");
  const required = new Set(
    Array.isArray(requiredValue)
      ? requiredValue.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );
  return Object.entries(properties).map(([name, value]) => {
    if (!value || typeof value !== "object")
      return { name, required: required.has(name) };
    const type = objectProperty(value, "type");
    const description = objectProperty(value, "description");
    const values = objectProperty(value, "enum");
    return {
      name,
      type: typeof type === "string" ? type : undefined,
      description: typeof description === "string" ? description : undefined,
      required: required.has(name),
      defaultValue: objectProperty(value, "default"),
      enum: Array.isArray(values) ? values : undefined,
    };
  });
}

export function toolsForAgent(
  state: LiveInspectionState,
  agentId: string,
): InspectorToolDefinition[] {
  return state.cachedTools.filter(
    (tool) => !tool.agentId || tool.agentId === agentId,
  );
}
