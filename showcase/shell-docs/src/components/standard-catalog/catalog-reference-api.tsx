"use client";

import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { TypeTable } from "fumadocs-ui/components/type-table";
import { standardUI } from "@copilotkit/react-core/v2/generative-ui";
import { COMMON_PROPS } from "./catalog-story";

// A component's description and API, read from the standard catalog's own
// manifest (shell-docs' `catalog-reference-api.tsx`). The catalog is a client
// module, so these render on the client.

export function CatalogReferenceDescription({ name }: { name: string }) {
  return <>{standardUI.manifestComponents[name]?.description}</>;
}

function schemaType(value: unknown): string {
  if (!value || typeof value !== "object") return "unknown";
  const schema = value as Record<string, unknown>;
  if (Array.isArray(schema.enum))
    return schema.enum.map((item) => JSON.stringify(item)).join(" | ");
  if (Array.isArray(schema.anyOf))
    return schema.anyOf.map(schemaType).join(" | ");
  if (schema.type === "array") return `${schemaType(schema.items)}[]`;
  return Array.isArray(schema.type)
    ? schema.type.join(" | ")
    : typeof schema.type === "string"
      ? schema.type
      : "object";
}

/**
 * Props as Fumadocs' type table (as `PropertyReference` renders), the shared
 * sizing props folded into an accordion under it, then slots and events.
 */
export function CatalogComponentApi({ name }: { name: string }) {
  const manifest = standardUI.manifestComponents[name];
  if (!manifest) return null;
  const properties = (manifest.props.properties ?? {}) as Record<
    string,
    { description?: string }
  >;
  const required = new Set(
    Array.isArray(manifest.props.required) ? manifest.props.required : [],
  );
  const table = (entries: [string, { description?: string }][]) =>
    Object.fromEntries(
      entries.map(([key, value]) => [
        key,
        {
          type: schemaType(value),
          description: value.description,
          required: required.has(key),
        },
      ]),
    );
  const all = Object.entries(properties);
  const own = all.filter(([key]) => !COMMON_PROPS.has(key));
  const common = all.filter(([key]) => COMMON_PROPS.has(key));
  const slots = Object.entries(manifest.slots ?? {});
  const events = Object.entries(manifest.events ?? {});
  return (
    <>
      {own.length > 0 && <TypeTable type={table(own)} />}
      {common.length > 0 && (
        <Accordions>
          <Accordion title={`Sizing and layout props (${common.length})`}>
            <TypeTable type={table(common)} />
          </Accordion>
        </Accordions>
      )}
      {slots.length > 0 && (
        <>
          <h3>Slots</h3>
          <ul>
            {slots.map(([key, kind]) => (
              <li key={key}>
                <code>{key}</code> · {kind}
              </li>
            ))}
          </ul>
        </>
      )}
      {events.length > 0 && (
        <>
          <h3>Events</h3>
          <ul>
            {events.map(([key, event]) => (
              <li key={key}>
                <code>{key}</code> · {event.description}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
