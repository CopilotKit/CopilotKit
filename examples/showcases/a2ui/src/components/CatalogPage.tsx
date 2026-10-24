import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import {
  GenerativeUISurface,
  useGenerativeUIRuntime,
} from "@copilotkit/react-core/v2/generative-ui";
import { Info } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  CATALOG,
  describe,
  specimenOperations,
  summary,
  unshownComponents,
} from "../lib/catalog";
import type { Specimen } from "../lib/catalog";
import { deskTheme, deskUI } from "../lib/generative-ui";
import { ViewFrame } from "./SurfaceFrame";

/**
 * The specimens render in a provider of their own: they belong to no
 * thread, and no agent sees them in its context.
 */
const GALLERY_UI = {
  ui: deskUI,
  theme: deskTheme,
  errorBoundary: { fallback: () => null },
};
const GALLERY_THREAD = "catalog";

type SurfaceManager = NonNullable<
  ReturnType<typeof useGenerativeUIRuntime>
>["manager"];
type SurfaceContent = Parameters<SurfaceManager["ingest"]>[2];

const surfaceIdOf = (specimen: Specimen) => `specimen-${specimen.name}`;

const componentCount = (specimens: Specimen[]) =>
  specimens.reduce((sum, s) => sum + 1 + (s.parts?.length ?? 0), 0);

/** Every component the agent can draw, each rendered from its A2UI. */
export function CatalogPage() {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      generativeUI={GALLERY_UI}
      enableInspector={false}
    >
      <Gallery />
    </CopilotKitProvider>
  );
}

function Gallery() {
  const manager = useGenerativeUIRuntime()?.manager;
  const unshown = useMemo(unshownComponents, []);

  // The specimens go into the gallery's own surface manager, the way the
  // agent's operations go into the chat's.
  useLayoutEffect(() => {
    if (!manager) return;
    manager.setActiveThread(GALLERY_THREAD);
    for (const section of CATALOG) {
      for (const specimen of section.specimens) {
        const surfaceId = surfaceIdOf(specimen);
        manager.ingest(GALLERY_THREAD, undefined, {
          surfaceId,
          target: surfaceId,
          catalogId: deskUI.id,
          operations: specimenOperations(
            surfaceId,
            specimen,
          ) as SurfaceContent["operations"],
          status: "ready",
          rejected: [],
        });
      }
    }
  }, [manager]);

  const scroller = useRef<HTMLDivElement>(null);
  const current = useCurrentSection(scroller);

  return (
    <div ref={scroller} className="catalog">
      <div className="catalog__inner">
        <nav className="catalog__nav" aria-label="Component groups">
          {CATALOG.map((section) => (
            <a
              key={section.id}
              href={`#catalog-${section.id}`}
              aria-current={current === section.id ? "true" : undefined}
              onClick={(event) => {
                event.preventDefault();
                document
                  .getElementById(`catalog-${section.id}`)
                  ?.scrollIntoView({ block: "start" });
              }}
            >
              {section.title}
              <span className="catalog__count">
                {componentCount(section.specimens)}
              </span>
            </a>
          ))}
        </nav>

        {CATALOG.map((section) => (
          <section
            key={section.id}
            id={`catalog-${section.id}`}
            className="catalog__section"
            aria-labelledby={`catalog-${section.id}-title`}
          >
            <header className="catalog__section-head">
              <h2 id={`catalog-${section.id}-title`}>{section.title}</h2>
              <p>{section.blurb}</p>
            </header>
            <div className="catalog__grid">
              {section.specimens.map((specimen) => (
                <SpecimenView key={specimen.name} specimen={specimen} />
              ))}
            </div>
          </section>
        ))}

        {unshown.length > 0 && (
          <section className="catalog__section" aria-labelledby="catalog-more">
            <header className="catalog__section-head">
              <h2 id="catalog-more">More</h2>
              <p>In the catalog, without a specimen here yet.</p>
            </header>
            <dl className="catalog__more">
              {unshown.map((name) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{summary(name)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}

function SpecimenView({ specimen }: { specimen: Specimen }) {
  const surfaceId = surfaceIdOf(specimen);
  const operations = useMemo(
    () => specimenOperations(surfaceId, specimen),
    [surfaceId, specimen],
  );
  const [aboutOpen, setAboutOpen] = useState(false);
  const about = useMemo(() => describe(specimen.name), [specimen.name]);
  const nameId = `${surfaceId}-name`;
  const aboutId = `${surfaceId}-about`;

  const head = (
    <>
      <header className="specimen__head">
        {/* h3: a view's own Title is an h2, so the outline holds */}
        <h3 id={nameId}>
          <code>{specimen.name}</code>
        </h3>
        <button
          type="button"
          className="specimen__about-toggle"
          aria-expanded={aboutOpen}
          aria-controls={aboutId}
          aria-label={`About ${specimen.name}`}
          title={`About ${specimen.name}`}
          onClick={() => setAboutOpen((open) => !open)}
        >
          <Info size={14} strokeWidth={2} aria-hidden />
        </button>
      </header>
      {aboutOpen && (
        <div
          id={aboutId}
          className="specimen__about"
          role="region"
          aria-labelledby={nameId}
        >
          <p>{about.description}</p>
          <dl>
            {specimen.parts && (
              <div>
                <dt>Works with</dt>
                <dd>
                  {specimen.parts.map((part) => (
                    <code key={part}>{part}</code>
                  ))}
                </dd>
              </div>
            )}
            {about.props.length > 0 && (
              <div>
                <dt>Props</dt>
                <dd>
                  {about.props.map((prop) => (
                    <code key={prop}>{prop}</code>
                  ))}
                  {about.layout && <span>and the layout props of Box</span>}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </>
  );

  return (
    <article
      className="specimen"
      data-wide={specimen.wide || undefined}
      data-overlay={specimen.overlay || undefined}
      aria-labelledby={nameId}
      onKeyDown={(event) => {
        if (event.key === "Escape" && aboutOpen) setAboutOpen(false);
      }}
    >
      <ViewFrame
        surfaceId={surfaceId}
        operations={operations}
        className="specimen__view"
        head={head}
      >
        <GenerativeUISurface id={surfaceId} autoScroll={false} />
      </ViewFrame>
    </article>
  );
}

/** The section the reader is in, for the group nav. */
function useCurrentSection(scroller: RefObject<HTMLDivElement | null>) {
  const [current, setCurrent] = useState(CATALOG[0].id);
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = visible[0]?.target.id.replace("catalog-", "");
        if (id) setCurrent(id);
      },
      // A section counts once its top passes under the nav.
      { root, rootMargin: "-15% 0px -70% 0px" },
    );
    for (const section of CATALOG) {
      const element = document.getElementById(`catalog-${section.id}`);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [scroller]);
  return current;
}
