"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { Backdrop, SectionTitle, Sidebar } from "../shell";
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

const ALL_COMPONENTS = Object.keys(standardUI.manifestComponents).sort();
const GROUPS = Array.from(new Set(SAMPLES.map((sample) => sample.group)));

/** A stable anchor per sample (two samples can start with the same component). */
const slugOf = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const SLUGS = SAMPLES.map((sample) => slugOf(sample.title));

/** The sample each component is first shown in. */
const FIRST_SAMPLE = new Map<string, number>();
SAMPLES.forEach((sample, index) =>
  sample.covers.forEach((name) => {
    if (!FIRST_SAMPLE.has(name)) FIRST_SAMPLE.set(name, index);
  }),
);

/** The thumb index: each group's components, in the order the samples show them. */
const SHOULDER = GROUPS.map((group) => ({
  group,
  names: Array.from(
    new Set(
      SAMPLES.filter((sample) => sample.group === group).flatMap((sample) =>
        sample.covers.filter(
          (name) => SAMPLES[FIRST_SAMPLE.get(name) ?? -1]?.group === group,
        ),
      ),
    ),
  ),
}));

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

/** Says so when the browser asks for reduced motion, which stops the components' animations. */
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
    <p className="ck-warn">
      This browser asks for reduced motion, so the shimmer, the spinners and the
      entrance animations are stopped. Turn off reduced motion in your system
      settings to see them.
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
    <p className="ck-event" role="status">
      Last event sent by a surface: <code>{last.content}</code>
    </p>
  );
}

/** Which samples are on screen, by index, for the sidebar's in-view marks. */
function useSamplesInView() {
  const [inView, setInView] = useState<number[]>([]);
  useEffect(() => {
    const visible = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.index);
          if (entry.isIntersecting) visible.add(index);
          else visible.delete(index);
        }
        setInView(Array.from(visible).sort((a, b) => a - b));
      },
      { threshold: 0 },
    );
    document
      .querySelectorAll<HTMLElement>(".ck-sample[data-index]")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  return inView;
}

function Sample({ sample, index }: { sample: CatalogSample; index: number }) {
  const surfaceId = sampleSurfaceId(index);
  const operations = sampleOperations(sample, surfaceId, standardUI.id);
  return (
    <section
      id={SLUGS[index]}
      data-index={index}
      className="ck-card ck-sample"
      aria-labelledby={`${SLUGS[index]}-title`}
    >
      <header className="ck-sample-head">
        <h4 id={`${SLUGS[index]}-title`}>{sample.title}</h4>
        <div className="ck-tags">
          {sample.covers.map((name) => (
            <span key={name} className="ck-tag">
              {name}
            </span>
          ))}
        </div>
      </header>
      <div className="ck-sample-body">
        <div className="ck-sample-preview">
          <GenerativeUISurface
            id={surfaceId}
            fallback={<p className="ck-loading">Loading the sample…</p>}
          />
          <p className="ck-sample-meta">
            {sample.components.length} components in the tree
            {sample.data ? " · bound to a data model" : ""}
          </p>
        </div>
        <div className="ck-sample-details">
          {sample.covers.map((name) => {
            const manifest = standardUI.manifestComponents[name];
            if (!manifest) return null;
            return (
              <details key={name}>
                <summary className="ck-focus">{name}</summary>
                <p>{manifest.description}</p>
                <pre>{manifestLines(manifest).join("\n")}</pre>
              </details>
            );
          })}
          <details>
            <summary className="ck-focus">Operations</summary>
            <pre>{JSON.stringify(operations, null, 1)}</pre>
          </details>
        </div>
      </div>
    </section>
  );
}

function ComponentLink({ name, inView }: { name: string; inView: boolean }) {
  const index = FIRST_SAMPLE.get(name);
  return (
    <li>
      <a
        href={`#${index === undefined ? "" : SLUGS[index]}`}
        className="ck-focus"
        data-inview={inView ? "" : undefined}
      >
        {name}
      </a>
    </li>
  );
}

function Catalog({ errors }: { errors: string[] }) {
  const covered = useMemo(
    () => new Set(SAMPLES.flatMap((sample) => sample.covers)),
    [],
  );
  const missing = ALL_COMPONENTS.filter((name) => !covered.has(name));
  const inView = useSamplesInView();
  // Only the sample at the top of the view is marked: "you are here", not a block.
  const inViewNames = new Set(
    inView.length > 0 ? (SAMPLES[inView[0]]?.covers ?? []) : [],
  );

  // Keep the marked names in sight in the sidebar as the samples scroll.
  const index = useRef<HTMLDivElement>(null);
  const firstInView = inView[0];
  useEffect(() => {
    const box = index.current?.closest<HTMLElement>(".ck-sidebar-scroll");
    const mark = index.current?.querySelector<HTMLElement>("a[data-inview]");
    if (!box || !mark) return;
    const top =
      mark.getBoundingClientRect().top -
      box.getBoundingClientRect().top +
      box.scrollTop;
    if (top < box.scrollTop + 60 || top > box.scrollTop + box.clientHeight - 80)
      box.scrollTo({
        top: Math.max(0, top - box.clientHeight / 3),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
  }, [firstInView]);

  return (
    <>
      <Backdrop />
      <div className="ck-app">
        <StartCatalog />
        <Sidebar current="catalog">
          <div ref={index} className="ck-index-groups">
            {SHOULDER.map(({ group, names }) => (
              <nav
                key={group}
                className="ck-index-group"
                aria-labelledby={`index-${slugOf(group)}`}
              >
                <SectionTitle id={`index-${slugOf(group)}`}>
                  {group}
                </SectionTitle>
                <ol className="ck-index">
                  {names.map((name) => (
                    <ComponentLink
                      key={name}
                      name={name}
                      inView={inViewNames.has(name)}
                    />
                  ))}
                </ol>
              </nav>
            ))}
          </div>
        </Sidebar>
        <main className="ck-scroll">
          <div className="ck-catalog">
            <header className="ck-card ck-catalog-head">
              <h2>{ALL_COMPONENTS.length} standard components</h2>
              <p>
                Every component in <code>{standardUI.id}</code>, rendered live
                from the operations a model would write. Open one to read the
                description and props the model sees.
              </p>
              <div className="ck-catalog-notes">
                <ReducedMotionNote />
                {missing.length > 0 && (
                  <p className="ck-warn">
                    No sample yet for: {missing.join(", ")}
                  </p>
                )}
                {errors.length > 0 && (
                  <pre className="ck-errors">{errors.join("\n")}</pre>
                )}
                <LastEvent />
              </div>
              <details className="ck-jump">
                <summary className="ck-focus">Jump to a component</summary>
                <ol>
                  {ALL_COMPONENTS.map((name) => (
                    <ComponentLink key={name} name={name} inView={false} />
                  ))}
                </ol>
              </details>
            </header>
            {GROUPS.map((group) => (
              <section
                key={group}
                className="ck-catalog"
                aria-labelledby={`group-${slugOf(group)}`}
              >
                <div className="ck-group-title">
                  <h3 id={`group-${slugOf(group)}`}>{group}</h3>
                  <span aria-hidden="true" />
                </div>
                {SAMPLES.map((sample, i) =>
                  sample.group === group ? (
                    <Sample key={sample.title} sample={sample} index={i} />
                  ) : null,
                )}
              </section>
            ))}
          </div>
        </main>
      </div>
    </>
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
