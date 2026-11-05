"use client";
import React from "react";
import { standardUI } from "@copilotkit/react-core/v2/generative-ui";

export function CatalogReferenceDescription({ name }: { name: string }) {
  return <>{standardUI.manifestComponents[name].description}</>;
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

export function CatalogComponentApi({ name }: { name: string }) {
  const manifest = standardUI.manifestComponents[name];
  const properties = manifest.props.properties as
    | Record<string, { description?: string }>
    | undefined;
  return (
    <div className="space-y-5">
      <div className="overflow-auto">
        <table>
          <thead>
            <tr>
              <th>Prop</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(properties ?? {}).map(([key, value]) => (
              <tr key={key}>
                <td>
                  <code>{key}</code>
                </td>
                <td className="text-xs">
                  <code>{schemaType(value)}</code>
                </td>
                <td>{value.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Object.keys(manifest.slots ?? {}).length > 0 && (
        <div>
          <h3>Slots</h3>
          <ul>
            {Object.entries(manifest.slots ?? {}).map(([key, kind]) => (
              <li key={key}>
                <code>{key}</code> · {kind}
              </li>
            ))}
          </ul>
        </div>
      )}
      {Object.keys(manifest.events ?? {}).length > 0 && (
        <div>
          <h3>Events</h3>
          <ul>
            {Object.entries(manifest.events ?? {}).map(([key, event]) => (
              <li key={key}>
                <code>{key}</code> · {event.description}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
