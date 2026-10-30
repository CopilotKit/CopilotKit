import { functionCallers } from "./basic-functions";
import {
  buildCompactGenerativeUISchema,
  compactProps,
  compactType,
} from "./compact-schema";
import type { GenerativeUISchemaSettings } from "./prompt-spec";
import { GENERATIVE_UI_AGENT_FUNCTION_CALLS } from "./types";
import type {
  GenerativeUIComponentManifest,
  GenerativeUIJSONSchema,
  GenerativeUIManifest,
} from "./types";

type SchemaManifest = Pick<
  GenerativeUIManifest,
  "catalogId" | "components" | "functions" | "targets" | "surfaces"
>;

/** An own key (shared compiles to ES2017, which has no Object.hasOwn). */
const hasOwn = (target: object, key: string) =>
  Object.prototype.hasOwnProperty.call(target, key);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The props schema without the description of each prop. */
function withoutPropDescriptions(
  schema: GenerativeUIJSONSchema,
): GenerativeUIJSONSchema {
  if (!isRecord(schema.properties)) return schema;
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => {
        if (!isRecord(value)) return [key, value];
        const { description: _description, ...rest } = value;
        return [key, rest];
      }),
    ),
  };
}

/** The short signature of a function: its built-in signature, or its schema made short. */
function functionSignature(fn: GenerativeUIManifest["functions"][string]) {
  const signature = fn.parameters.description;
  const hasSignature =
    typeof signature === "string" &&
    signature.startsWith("{") &&
    Object.keys(fn.parameters).length === 2;
  return hasSignature ? signature : compactType(fn.parameters, 0);
}

/**
 * One component as a TypeScript-like signature line, with its events and
 * slots on the lines below:
 * `- Text(text?: string // The text): Shows text`.
 */
function signatureLines(
  name: string,
  component: GenerativeUIComponentManifest,
  settings: GenerativeUISchemaSettings,
) {
  const props = Object.entries(
    compactProps(component.props, settings.propDescriptions),
  ).map(([key, type]) => `${key}: ${type}`);
  const lines = [
    `- ${name}(${props.join(", ")})${component.description ? `: ${component.description}` : ""}`,
  ];
  const events = Object.entries(component.events ?? {}).map(
    ([event, definition]) =>
      `${event}(${definition.description ?? compactType(definition.parameters, 0)})`,
  );
  if (events.length > 0) lines.push(`  events: ${events.join(", ")}`);
  const slots = Object.entries(component.slots ?? {}).map(
    ([slot, kind]) => `${slot} (${kind})`,
  );
  if (slots.length > 0) lines.push(`  slots: ${slots.join(", ")}`);
  return lines;
}

/** The whole schema as signature text: targets, functions, components, surfaces. */
function signatureSchema(
  manifest: SchemaManifest,
  settings: GenerativeUISchemaSettings,
) {
  const targets = manifest.targets.map((t) => {
    const limit = t.components ? `; only ${t.components.join(", ")}` : "";
    return `- ${t.id} (${t.kind}${limit})${t.description ? `: ${t.description}` : ""}`;
  });
  const functions = Object.entries(manifest.functions).map(([name, fn]) => {
    const callers = functionCallers(fn);
    const who =
      callers.agent && GENERATIVE_UI_AGENT_FUNCTION_CALLS
        ? callers.renderer
          ? " (UI or agent)"
          : " (agent only)"
        : "";
    return `- ${name}${functionSignature(fn)}${who}${fn.description ? `: ${fn.description}` : ""}`;
  });
  const components = Object.entries(manifest.components).flatMap(
    ([name, component]) => signatureLines(name, component, settings),
  );
  const surfaces = Object.entries(manifest.surfaces).map(
    ([id, s]) =>
      `- ${id} (target ${s.target})${s.status ? ` status: ${s.status}` : ""}${s.dataModel ? ` user values: ${JSON.stringify(s.dataModel)}` : ""}${(s.rejected ?? []).map((r) => ` rejected: ${r}`).join("")}`,
  );
  return [
    `Catalog: ${manifest.catalogId}`,
    `Targets:\n${targets.join("\n") || "- none"}`,
    `Functions:\n${functions.join("\n") || "- none"}`,
    `Components:\n${components.join("\n") || "- none"}`,
    `Surfaces:\n${surfaces.join("\n") || "- none"}`,
  ].join("\n\n");
}

/**
 * A compact type with bare enum values and tight unions:
 * `"sm" | "md" | "lg"` becomes `sm|md|lg`. Values that are not plain words
 * keep their quotes.
 */
function bareType(type: string) {
  return type.replace(/"([A-Za-z0-9_#%.-]+)"/g, "$1").replace(/ \| /g, "|");
}

/** A compact prop (`type // description`) as `name: type - description`. */
function propLine(key: string, value: string) {
  const name = key.endsWith("?") ? key.slice(0, -1) : `${key}*`;
  const cut = value.indexOf(" // ");
  const type = bareType(cut < 0 ? value : value.slice(0, cut));
  const text = cut < 0 ? "" : value.slice(cut + 4).trim();
  const description = text ? ` - ${text}` : "";
  return ` ${name}: ${type}${description}`;
}

/**
 * The whole schema as plain lines: a header line per component and one
 * indented line per prop: events are `action` props and slots `componentId`
 * or `childList` props. Props are optional unless marked `*`, enum values
 * are bare, and the common props are listed once. It carries the same names, types and descriptions as
 * `compact`, in fewer tokens.
 */
function linesSchema(
  manifest: SchemaManifest,
  settings: GenerativeUISchemaSettings,
) {
  const compact = buildCompactGenerativeUISchema(manifest, {
    propDescriptions: settings.propDescriptions,
    commonProps: settings.commonProps,
  });
  const targets = compact.targets
    .map((t) => {
      const limit = t.components ? `, only ${t.components.join(", ")}` : "";
      return `${t.id} (${t.kind}${limit})${t.description ? `: ${t.description}` : ""}`;
    })
    .join("; ");
  const functions = Object.entries(compact.functions).map(
    ([name, fn]) =>
      `${name}${fn.parameters}${"callers" in fn ? ` (${fn.callers})` : ""}${fn.description ? `: ${fn.description}` : ""}`,
  );
  const common = compact.commonProps
    ? Object.entries(compact.commonProps).map(([k, v]) => propLine(k, v))
    : [];
  const lineSets = Object.entries(compact.components).map(([name, c]) => ({
    name,
    c,
    own: [
      ...Object.entries(c.props).map(([k, v]) => propLine(k, v)),
      ...Object.entries(c.events ?? {}).map(([e, d]) => ` ${e}: action - ${d}`),
    ],
  }));
  const components = lineSets.flatMap(({ name, c, own }) => {
    const lines = [
      `${name}${c.includesCommonProps ? " +common" : ""}${c.description ? `: ${c.description}` : ""}`,
      ...own,
    ];
    // Slots are props that take component ids.
    for (const [slot, kind] of Object.entries(c.slots ?? {})) {
      lines.push(
        ` ${slot}: ${kind === "single" ? "componentId" : "childList"}`,
      );
    }
    return lines;
  });
  const surfaces = Object.keys(compact.surfaces).length
    ? JSON.stringify(compact.surfaces)
    : "none";
  return [
    `Catalog ${compact.catalogId}. Targets: ${targets || "none"}`,
    'Props are optional unless marked *. a|b|c is one of those strings. A component marked +common also takes every common prop. A prop of type action is an event prop: give it {"event":{...}} or {"functionCall":{...}}. A componentId prop takes one component id; a childList prop takes a list of ids or a template.',
    `Functions:\n${functions.join("\n")}`,
    ...(common.length ? [`Common props:\n${common.join("\n")}`] : []),
    `Components:\n${components.join("\n")}`,
    `Surfaces: ${surfaces}`,
  ].join("\n\n");
}

/**
 * The component schema of the markdown transport, as the text of its
 * context entry, in the notation of `settings`. `compact` is the schema that
 * ships (`buildCompactGenerativeUISchema`), `json-schema` the manifest parts
 * as JSON, `ts-signature` one line per component, `lines` one line per
 * prop with bare enums (the fewest tokens).
 *
 * @example
 * ```ts
 * const value = renderGenerativeUISchema(manifest, spec.schema.markdown);
 * ```
 */
export function renderGenerativeUISchema(
  manifest: SchemaManifest,
  settings: GenerativeUISchemaSettings,
): string {
  switch (settings.notation) {
    case "compact":
      return JSON.stringify(
        buildCompactGenerativeUISchema(manifest, {
          propDescriptions: settings.propDescriptions,
          commonProps: settings.commonProps,
        }),
      );
    case "json-schema": {
      const components = Object.fromEntries(
        Object.entries(manifest.components).map(([name, c]) => [
          name,
          settings.propDescriptions
            ? c
            : { ...c, props: withoutPropDescriptions(c.props) },
        ]),
      );
      return JSON.stringify({
        catalogId: manifest.catalogId,
        targets: manifest.targets,
        functions: manifest.functions,
        components,
        surfaces: manifest.surfaces,
      });
    }
    case "ts-signature":
      return signatureSchema(manifest, settings);
    case "lines":
      return linesSchema(manifest, settings);
  }
}

/**
 * The component list of the tool guide, one entry per component, in the
 * notation of `settings`. `json-schema` is the list that ships.
 */
export function renderGenerativeUIComponentList(
  components: GenerativeUIManifest["components"],
  settings: GenerativeUISchemaSettings,
): string {
  return Object.entries(components)
    .map(([name, c]) => {
      if (
        settings.notation === "ts-signature" ||
        settings.notation === "lines"
      ) {
        return signatureLines(name, c, settings).join("\n");
      }
      const props =
        settings.notation === "compact"
          ? compactProps(c.props, settings.propDescriptions)
          : settings.propDescriptions
            ? c.props
            : withoutPropDescriptions(c.props);
      const lines = [
        `- **${name}**${c.description ? `: ${c.description}` : ""}`,
        `  props: ${JSON.stringify(props)}`,
      ];
      if (c.events) lines.push(`  event props: ${JSON.stringify(c.events)}`);
      if (c.slots)
        lines.push(`  slot props (component ids): ${JSON.stringify(c.slots)}`);
      return lines.join("\n");
    })
    .join("\n");
}

/**
 * The manifest with replaced descriptions: `"Name"` replaces the
 * description of a component, `"Name.prop"` the description of one of its
 * props. Keys that name no component or prop are left out of the result
 * and listed in `unknown`. The manifest is not changed.
 */
export function applyDescriptionOverrides<
  M extends Pick<GenerativeUIManifest, "components">,
>(
  manifest: M,
  overrides: Record<string, string>,
): { manifest: M; unknown: string[] } {
  const components = structuredClone(manifest.components);
  const unknown: string[] = [];
  for (const [key, description] of Object.entries(overrides)) {
    const [name, prop, ...rest] = key.split(".");
    // Own keys only: "__proto__" must never reach Object.prototype.
    const component = hasOwn(components, name) ? components[name] : undefined;
    if (!component || rest.length > 0) {
      unknown.push(key);
      continue;
    }
    if (prop === undefined) {
      component.description = description;
      continue;
    }
    const properties = component.props.properties;
    const property =
      isRecord(properties) && hasOwn(properties, prop)
        ? properties[prop]
        : undefined;
    if (!isRecord(property)) {
      unknown.push(key);
      continue;
    }
    property.description = description;
  }
  return { manifest: { ...manifest, components }, unknown };
}

/**
 * The components and props of `manifest` whose names do not appear in
 * `rendered`. A schema notation that leaves one out would hide part of the
 * catalog from the model.
 */
export function schemaCoverage(
  manifest: Pick<GenerativeUIManifest, "components">,
  rendered: string,
): { missing: string[] } {
  const missing: string[] = [];
  for (const [name, component] of Object.entries(manifest.components)) {
    if (!rendered.includes(name)) missing.push(name);
    const properties = isRecord(component.props.properties)
      ? component.props.properties
      : {};
    for (const prop of Object.keys(properties)) {
      if (!rendered.includes(prop)) missing.push(`${name}.${prop}`);
    }
  }
  return { missing };
}
