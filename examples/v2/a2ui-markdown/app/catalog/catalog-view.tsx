"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CopilotKitProvider,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import { GenerativeUISurface } from "@copilotkit/react-core/v2/generative-ui";
import type {
  GenerativeUI,
  GenerativeUIErrorInfo,
  GenerativeUITheme,
} from "@copilotkit/react-core/v2/generative-ui";
import type { KumoCoverage } from "../../kumo/coverage";
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

type ComponentManifest = GenerativeUI["manifestComponents"][string];
type Coverage = Readonly<Record<string, KumoCoverage>>;

/** The tag next to a component name: how the Kumo catalog draws it. */
const COVERAGE_LABEL: Record<KumoCoverage, string> = {
  kumo: "Kumo",
  composed: "Composed",
  primitive: "Primitive",
  standard: "\u2691 Standard",
};

function CoverageTag({ kind }: { kind: KumoCoverage | undefined }) {
  if (!kind) return null;
  return (
    <span className="ex-cat-coverage" data-coverage={kind}>
      {COVERAGE_LABEL[kind]}
    </span>
  );
}

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

/**
 * Tells the viewer when the browser asks for reduced motion: the standard
 * components then stop the shimmer, the spinners and the entrance
 * animations, which otherwise looks like a bug on this page.
 */
function ReducedMotionNote() {
  const [isReduced, setIsReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setIsReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  if (!isReduced) return null;
  return (
    <p className="ex-cat-warning">
      This browser asks for reduced motion, so the shimmer, the spinners and the
      entrance animations are stopped. Turn off the reduce motion setting of
      your system to see them.
    </p>
  );
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
  ui,
  coverage,
}: {
  sample: CatalogSample;
  index: number;
  ui: GenerativeUI;
  coverage?: Coverage;
}) {
  const surfaceId = sampleSurfaceId(index);
  const operations = sampleOperations(sample, surfaceId, ui.id);
  return (
    <section id={sample.covers[0]} className="ex-cat-card">
      <header className="ex-cat-card-header">
        <h3 className="ex-cat-card-title">{sample.title}</h3>
        <div className="ex-cat-names">
          {sample.covers.map((name) => (
            <span key={name} className="ex-cat-name">
              <code>{name}</code>
              <CoverageTag kind={coverage?.[name]} />
            </span>
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
            const manifest = ui.manifestComponents[name];
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

interface CatalogViewProps {
  /** The components to show: standardUI, or the Kumo version. */
  ui: GenerativeUI;
  theme?: GenerativeUITheme;
  /** How the Kumo catalog draws each component. Shown as a tag. */
  coverage?: Coverage;
  /** Where the chat page is: "" or "/kumo". */
  basePath: "" | "/kumo";
}

function Catalog({
  errors,
  ui,
  coverage,
  basePath,
}: Omit<CatalogViewProps, "theme"> & { errors: string[] }) {
  const all = Object.keys(ui.manifestComponents).sort();
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
              {all.length} components in <code>{ui.id}</code>, rendered from the
              operations a model would write.
            </p>
          </div>
        </div>
        <nav className="ex-controls" aria-label="Pages">
          <Link className="ex-pill ex-pill-plain" href={basePath || "/"}>
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
          <ReducedMotionNote />
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
                data-coverage={coverage?.[name]}
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
              <SampleCard
                key={sample.title}
                sample={sample}
                index={index}
                ui={ui}
                coverage={coverage}
              />
            ) : null,
          )}
        </div>
      ))}
    </main>
  );
}

/** The catalog page, with the standard components or the Kumo ones. */
export function CatalogView({
  ui,
  theme,
  coverage,
  basePath,
}: CatalogViewProps) {
  const [agents] = useState(() => ({
    default: createCatalogAgent(SAMPLES, ui.id),
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
      generativeUI={{ ui, theme, errorBoundary: { onError } }}
    >
      <Catalog
        errors={errors}
        ui={ui}
        coverage={coverage}
        basePath={basePath}
      />
    </CopilotKitProvider>
  );
}
