"use client";

import { useEffect, useRef, useState } from "react";
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
    <p className="ex-cat-event" role="status">
      <span className="ex-tag">Last event</span>
      <code>{last.content}</code>
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
    <section id={sample.covers[0]} className="ex-cat-card">
      <header className="ex-cat-card-header">
        <h3 className="ex-cat-card-title">{sample.title}</h3>
        <div className="ex-cat-names">
          {sample.covers.map((name) => (
            <code key={name}>{name}</code>
          ))}
        </div>
      </header>
      <div className="ex-cat-card-body">
        <div className="ex-cat-preview">
          <GenerativeUISurface
            id={surfaceId}
            fallback={<p className="ex-cat-loading">Loading the sample...</p>}
          />
        </div>
        <div className="ex-cat-details">
          {sample.covers.map((name) => {
            const manifest = standardUI.manifestComponents[name];
            if (!manifest) return null;
            return (
              <details key={name}>
                <summary>{name}</summary>
                <p>{manifest.description}</p>
                <pre>{manifestLines(manifest).join("\n")}</pre>
              </details>
            );
          })}
          <details>
            <summary>Operations</summary>
            <pre>{JSON.stringify(operations, null, 1)}</pre>
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
    <main className="ex-shell ex-cat">
      <StartCatalog />
      <header className="ex-topbar">
        <div className="ex-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG logo */}
          <img src="/copilotkit-logo.svg" alt="CopilotKit" />
          <span className="ex-brand-divider" aria-hidden="true" />
          <div>
            <h1 className="ex-title">Standard components</h1>
            <p className="ex-subtitle">
              {all.length} components in <code>{standardUI.id}</code>, rendered
              from the operations a model would write.
            </p>
          </div>
        </div>
        <nav className="ex-controls" aria-label="Pages">
          <Link className="ex-pill ex-pill-plain" href="/">
            Back to the chat
          </Link>
        </nav>
      </header>
      <section className="ex-panel ex-cat-intro" aria-label="Components">
        <div className="ex-panel-body">
          <p className="ex-panel-hint">
            Each sample lists the description and the props that the model sees.
            Click a name to jump to its sample.
          </p>
          {missing.length > 0 && (
            <p className="ex-cat-warning">
              No sample yet for: {missing.join(", ")}
            </p>
          )}
          {errors.length > 0 && (
            <pre className="ex-cat-errors">{errors.join("\n")}</pre>
          )}
          <LastEvent />
          <nav className="ex-cat-index" aria-label="Component index">
            {all.map((name) => (
              <a
                key={name}
                href={`#${anchorOf(name)}`}
                data-missing={covered.has(name) ? undefined : ""}
              >
                {name}
              </a>
            ))}
          </nav>
        </div>
      </section>
      {groups.map((group) => (
        <div key={group} className="ex-cat-group">
          <h2 className="ex-cat-group-title">{group}</h2>
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
