"use client";

import { standardUI } from "@copilotkit/react-core/v2/generative-ui";
import { PropsTable, type PropRow } from "./props-table";

/**
 * Props tables for the Gen UI 2.0 standard components, read from the
 * installed package: `standardUI.manifestComponents` holds each one's
 * description, a JSON Schema of its props, its child slots and its events.
 * A client component because the package is a "use client" module; it still
 * renders on the server for the first paint.
 */
type Schema = {
  type?: string | string[];
  enum?: unknown[];
  anyOf?: Schema[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  $ref?: string;
  description?: string;
};
type Spec = {
  props: Schema;
  events?: Record<string, { description?: string }>;
  slots?: Record<string, "single" | "multiple">;
  parameterOrder?: string[];
};

const SPECS = standardUI.manifestComponents as unknown as Record<string, Spec>;

const CHILD_ONE = "component id";
const CHILD_LIST = "string[] | { componentId, path }";

function typeOf(s: Schema, depth = 0): string {
  if (s.$ref) {
    const ref = s.$ref.split("/").pop() ?? "any";
    return ref === "ComponentId" ? CHILD_ONE : ref === "ChildList" ? CHILD_LIST : ref;
  }
  if (s.enum) {
    const v = s.enum.map((x) => JSON.stringify(x));
    return v.length > 6 ? `${v.slice(0, 6).join(" | ")} | ...` : v.join(" | ");
  }
  if (s.anyOf) return s.anyOf.map((o) => typeOf(o, depth + 1)).join(" | ");
  if (Array.isArray(s.type)) return s.type.join(" | ");
  if (s.type === "array") {
    const el = s.items ? typeOf(s.items, depth + 1) : "any";
    return el.includes("|") ? `(${el})[]` : `${el}[]`;
  }
  if (s.type === "object") {
    const keys = Object.keys(s.properties ?? {});
    if (!keys.length || depth > 2) return "object";
    const req = new Set(s.required ?? []);
    return `{ ${keys.map((k) => `${k}${req.has(k) ? "" : "?"}`).join(", ")} }`;
  }
  return s.type ?? "any";
}

export function standardPropRows(name: string): PropRow[] | null {
  if (!Object.hasOwn(SPECS, name)) return null;
  const spec = SPECS[name];
  const props = spec.props.properties ?? {};
  const required = new Set(spec.props.required ?? []);
  const row = (k: string): PropRow | null => {
    const slot = spec.slots?.[k];
    if (slot) {
      return slot === "single"
        ? { name: k, type: CHILD_ONE, required: false, description: "Id of one child component." }
        : { name: k, type: CHILD_LIST, required: false, description: "Ids of child components, or a template { componentId, path } over a data list." };
    }
    const event = spec.events?.[k];
    if (event) return { name: k, type: "Action (event or functionCall)", required: false, description: event.description ?? null };
    const p = props[k];
    return p ? { name: k, type: typeOf(p), required: required.has(k), description: p.description ?? null } : null;
  };
  // The package's own parameter order, then anything it leaves out.
  const order = [...(spec.parameterOrder ?? []), ...Object.keys(spec.slots ?? {}), ...Object.keys(spec.events ?? {}), ...Object.keys(props)];
  return [...new Set(order)].map(row).filter((r): r is PropRow => !!r);
}

export function StandardProps({ name }: { name: string }) {
  const rows = standardPropRows(name);
  if (!rows) return <p className="mt-2 text-[14px] text-muted-foreground">The installed Gen UI 2.0 package does not list {name}.</p>;
  if (!rows.length) return <p className="mt-2 text-[14px] text-muted-foreground">{name} takes no props.</p>;
  return <PropsTable rows={rows} />;
}
