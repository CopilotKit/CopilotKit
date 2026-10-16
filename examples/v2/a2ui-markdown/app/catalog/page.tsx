"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  A2UIProvider,
  A2UIRenderer,
  buildCompactCatalogSchema,
  standardCatalog,
  STANDARD_CATALOG_ID,
  useA2UI,
} from "@copilotkit/a2ui-renderer";
import type { A2UIClientEventMessage } from "@copilotkit/a2ui-renderer";
import { SAMPLES } from "./samples";
import type { CatalogSample } from "./samples";

/**
 * Every standard-catalog component rendered live from the A2UI operations
 * the model would write, next to the description and props the model sees.
 * No agent or runtime involved: operations go straight into the renderer.
 */

type CompactSchema = {
  components: Record<
    string,
    { description: string; props: Record<string, string> }
  >;
};

function Surface({
  sample,
  surfaceId,
}: {
  sample: CatalogSample;
  surfaceId: string;
}) {
  const { processMessages } = useA2UI();
  useEffect(() => {
    const ops: Array<Record<string, unknown>> = [
      {
        version: "v0.9",
        createSurface: { surfaceId, catalogId: STANDARD_CATALOG_ID },
      },
    ];
    if (sample.data) {
      ops.push({
        version: "v0.9",
        updateDataModel: { surfaceId, path: "/", value: sample.data },
      });
    }
    ops.push({
      version: "v0.9",
      updateComponents: { surfaceId, components: sample.components },
    });
    processMessages(ops);
  }, [processMessages, sample, surfaceId]);
  return <A2UIRenderer surfaceId={surfaceId} />;
}

function SampleCard({
  sample,
  index,
  schema,
}: {
  sample: CatalogSample;
  index: number;
  schema: CompactSchema;
}) {
  const [lastAction, setLastAction] = useState<string | null>(null);
  const onAction = (message: A2UIClientEventMessage) => {
    const a = message.userAction;
    if (!a) return;
    setLastAction(
      `${a.name}${a.context ? " " + JSON.stringify(a.context) : ""}`,
    );
  };
  return (
    <section
      id={sample.covers[0]}
      style={{ borderTop: "1px solid #e5e7eb", padding: "24px 0" }}
    >
      <h3 style={{ margin: "0 0 4px", fontSize: 17 }}>{sample.title}</h3>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "#6b7280" }}>
        {sample.covers.map((name) => (
          <code key={name} style={{ marginRight: 8 }}>
            {name}
          </code>
        ))}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)",
          gap: 24,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <A2UIProvider catalog={standardCatalog} onAction={onAction}>
            <Surface sample={sample} surfaceId={`catalog-${index}`} />
          </A2UIProvider>
          {lastAction && (
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "#0f766e" }}>
              action: <code>{lastAction}</code>
            </p>
          )}
        </div>
        <div style={{ minWidth: 0, fontSize: 12, color: "#374151" }}>
          {sample.covers.map((name) => {
            const def = schema.components[name];
            if (!def) return null;
            return (
              <details key={name} style={{ marginBottom: 8 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                  {name}
                </summary>
                <p style={{ margin: "6px 0" }}>{def.description}</p>
                <pre
                  style={{
                    margin: 0,
                    padding: 10,
                    background: "#f3f4f6",
                    borderRadius: 6,
                    overflowX: "auto",
                    fontSize: 11,
                    lineHeight: 1.45,
                  }}
                >
                  {Object.entries(def.props)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join("\n")}
                </pre>
              </details>
            );
          })}
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>
              A2UI operations
            </summary>
            <pre
              style={{
                margin: "6px 0 0",
                padding: 10,
                background: "#f3f4f6",
                borderRadius: 6,
                overflowX: "auto",
                fontSize: 11,
                lineHeight: 1.45,
              }}
            >
              {JSON.stringify(
                {
                  components: sample.components,
                  ...(sample.data ? { data: sample.data } : {}),
                },
                null,
                1,
              )}
            </pre>
          </details>
        </div>
      </div>
    </section>
  );
}

export default function CatalogPage() {
  const schema = useMemo(
    () =>
      buildCompactCatalogSchema(standardCatalog) as unknown as CompactSchema,
    [],
  );
  const all = useMemo(() => Object.keys(schema.components).sort(), [schema]);
  const covered = useMemo(() => new Set(SAMPLES.flatMap((s) => s.covers)), []);
  const missing = all.filter((name) => !covered.has(name));
  const groups = Array.from(new Set(SAMPLES.map((s) => s.group)));

  return (
    <main
      style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px 80px" }}
    >
      <header style={{ marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
          <Link href="/">← back to the chat</Link>
        </p>
        <h1 style={{ margin: "8px 0 4px", fontSize: 24 }}>Standard catalog</h1>
        <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>
          {all.length} components, rendered from the A2UI operations a model
          would write. Each sample lists the description and props the model
          sees in the compact schema.
        </p>
        {missing.length > 0 && (
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#b45309" }}>
            No sample yet for: {missing.join(", ")}
          </p>
        )}
        <nav
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "4px 10px",
            marginTop: 12,
            fontSize: 12,
          }}
        >
          {all.map((name) => (
            <a
              key={name}
              href={`#${SAMPLES.find((s) => s.covers.includes(name))?.covers[0] ?? name}`}
              style={{ color: covered.has(name) ? "#374151" : "#b45309" }}
            >
              {name}
            </a>
          ))}
        </nav>
      </header>
      {groups.map((group) => (
        <div key={group}>
          <h2 style={{ fontSize: 20, margin: "32px 0 0" }}>{group}</h2>
          {SAMPLES.map((sample, i) =>
            sample.group === group ? (
              <SampleCard
                key={sample.title}
                sample={sample}
                index={i}
                schema={schema}
              />
            ) : null,
          )}
        </div>
      ))}
    </main>
  );
}
