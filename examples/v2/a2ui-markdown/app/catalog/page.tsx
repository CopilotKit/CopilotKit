"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import {
  CopilotKitProvider,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import {
  GenerativeUISurface,
  standardUI,
} from "@copilotkit/react-core/v2/generative-ui";
import type { GenerativeUIErrorInfo } from "@copilotkit/react-core/v2/generative-ui";
import {
  createCatalogAgent,
  sampleOperations,
  sampleSurfaceId,
} from "./catalog-agent";
import { SAMPLES } from "./samples";
import type { CatalogSample } from "./samples";

/**
 * Every standard component rendered live from the operations a model would
 * write, next to the description and props the model sees. A scripted agent
 * streams the surfaces (see ./catalog-agent.ts). No model and no runtime.
 */

type ComponentManifest = (typeof standardUI.manifestComponents)[string];

const preStyle: CSSProperties = {
  margin: "6px 0 0",
  padding: 10,
  background: "#f3f4f6",
  borderRadius: 6,
  overflowX: "auto",
  fontSize: 11,
  lineHeight: 1.45,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The JSON schema type of one prop, in one short line. */
function typeOf(schema: Record<string, unknown>) {
  if (Array.isArray(schema.enum)) return schema.enum.join(" | ");
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  return "union";
}

/** One line per prop, slot and event of a component. */
function manifestLines(manifest: ComponentManifest) {
  const properties = isRecord(manifest.props.properties)
    ? manifest.props.properties
    : {};
  const props = Object.entries(properties).map(([name, schema]) => {
    if (!isRecord(schema)) return name;
    const description =
      typeof schema.description === "string" ? `  ${schema.description}` : "";
    return `${name}: ${typeOf(schema)}${description}`;
  });
  const slots = Object.entries(manifest.slots ?? {}).map(
    ([name, kind]) => `${name}: slot (${kind})`,
  );
  const events = Object.keys(manifest.events ?? {}).map(
    (name) => `${name}: event`,
  );
  return [...props, ...slots, ...events];
}

/** Starts the first run, which streams every sample surface. */
function StartCatalog() {
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void copilotkit.runAgent({ agent });
  }, [copilotkit, agent]);
  return null;
}

/** The text of the last user message: the last event a surface sent. */
function LastEvent() {
  const { agent } = useAgent();
  const userMessages = agent.messages.filter(
    (message) => message.role === "user",
  );
  const last = userMessages[userMessages.length - 1];
  if (!last || typeof last.content !== "string") return null;
  return (
    <p style={{ margin: "8px 0 0", fontSize: 12, color: "#0f766e" }}>
      Last event: <code>{last.content}</code>
    </p>
  );
}

function SampleCard({
  sample,
  index,
}: {
  sample: CatalogSample;
  index: number;
}) {
  const surfaceId = sampleSurfaceId(index);
  const operations = sampleOperations(sample, surfaceId, standardUI.id);
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
          <GenerativeUISurface
            id={surfaceId}
            fallback={<p style={{ fontSize: 13 }}>Loading the sample...</p>}
          />
        </div>
        <div style={{ minWidth: 0, fontSize: 12, color: "#374151" }}>
          {sample.covers.map((name) => {
            const manifest = standardUI.manifestComponents[name];
            if (!manifest) return null;
            return (
              <details key={name} style={{ marginBottom: 8 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                  {name}
                </summary>
                <p style={{ margin: "6px 0" }}>{manifest.description}</p>
                <pre style={preStyle}>{manifestLines(manifest).join("\n")}</pre>
              </details>
            );
          })}
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>
              Operations
            </summary>
            <pre style={preStyle}>{JSON.stringify(operations, null, 1)}</pre>
          </details>
        </div>
      </div>
    </section>
  );
}

function Catalog({ errors }: { errors: string[] }) {
  const all = Object.keys(standardUI.manifestComponents).sort();
  const covered = new Set(SAMPLES.flatMap((sample) => sample.covers));
  const missing = all.filter((name) => !covered.has(name));
  const groups = Array.from(new Set(SAMPLES.map((sample) => sample.group)));
  const anchorOf = (name: string) =>
    SAMPLES.find((sample) => sample.covers.includes(name))?.covers[0] ?? name;

  return (
    <main
      style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px 80px" }}
    >
      <StartCatalog />
      <header style={{ marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
          <Link href="/">Back to the chat</Link>
        </p>
        <h1 style={{ margin: "8px 0 4px", fontSize: 24 }}>
          Standard components
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>
          {all.length} components in <code>{standardUI.id}</code>, rendered from
          the operations a model would write. Each sample lists the description
          and props the model sees.
        </p>
        {missing.length > 0 && (
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#b45309" }}>
            No sample yet for: {missing.join(", ")}
          </p>
        )}
        {errors.length > 0 && (
          <pre style={{ ...preStyle, color: "#b91c1c" }}>
            {errors.join("\n")}
          </pre>
        )}
        <LastEvent />
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
              href={`#${anchorOf(name)}`}
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
          {SAMPLES.map((sample, index) =>
            sample.group === group ? (
              <SampleCard key={sample.title} sample={sample} index={index} />
            ) : null,
          )}
        </div>
      ))}
    </main>
  );
}

export default function CatalogPage() {
  const [agents] = useState(() => ({
    default: createCatalogAgent(SAMPLES, standardUI.id),
  }));
  const [errors, setErrors] = useState<string[]>([]);
  const onError = (info: GenerativeUIErrorInfo) =>
    setErrors((current) => [
      ...current,
      `${info.kind} error in ${info.surfaceId}${info.componentId ? `/${info.componentId}` : ""}: ${info.error.message}`,
    ]);

  return (
    <CopilotKitProvider
      agents__unsafe_dev_only={agents}
      generativeUI={{ ui: standardUI, errorBoundary: { onError } }}
    >
      <Catalog errors={errors} />
    </CopilotKitProvider>
  );
}
