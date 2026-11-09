import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { highlight } from "sugar-high";
import { definitions, type ComponentName } from "@/a2ui/catalog/definitions";
import { CATALOG_ID } from "@/a2ui/catalog/ids";
import { firstSentence } from "@/a2ui/catalog/prompt-trim";
import { sampleFor, sampleOps } from "@/a2ui/catalog/samples";
import type { Sample } from "@/a2ui/catalog/samples/types";
import { toExpress } from "@/agent/express";
import {
  CATEGORY_SLUG,
  FLAT,
  isComponentName,
} from "@/components/docs/catalog-index";
import { ComponentTabs, type Code } from "@/components/docs/component-tabs";
import { PropsTable } from "@/components/docs/props-table";
import {
  definitionSource,
  propRows,
  rendererSource,
  templatesUsing,
} from "@/components/docs/source";
import {
  isStandardName,
  STANDARD_DOCS_URL,
  STANDARD_NAMES,
  standardDescription,
} from "@/components/docs/standard-index";
import { StandardProps } from "@/components/docs/standard-props";
import { INTRINSIC } from "@/components/docs/tile-sizes";
import { highlightCode } from "@/components/start/highlight";

/** The playground's components, then the Gen UI 2.0 standard ones. Any other name is a 404. */
export function generateStaticParams() {
  return [...FLAT, ...STANDARD_NAMES].map((name) => ({ name }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  if (isComponentName(name))
    return {
      title: `${name} | A2UI Components`,
      description: definitions[name].description,
    };
  if (isStandardName(name))
    return {
      title: `${name} | A2UI Components`,
      description: firstSentence(standardDescription(name)),
    };
  return {};
}

function code(slice: { file: string; code: string | null }): Code {
  return {
    file: slice.file,
    raw: slice.code,
    html: slice.code ? highlight(slice.code) : null,
  };
}

/** The page's sample as A2UI Express: the same operations, decompiled with `toExpress`. */
function expressOf(name: string, sample: Sample): Code {
  let text: string | null = null;
  try {
    text = toExpress(sampleOps(name, sample, CATALOG_ID) as never);
  } catch {
    // The Express tab says the sample does not decompile.
  }
  return {
    file: text
      ? `${text.split("\n").length} lines, A2UI Express`
      : "A2UI Express",
    raw: text,
    html: text ? highlightCode(text, "py") : null,
  };
}

/** Plain-language meaning of common prop names, used when the Zod definition has no .describe(). */
const PROP_HINTS: Record<string, string> = {
  label: "Short label shown with the value or control.",
  value: "The value shown, or the bound value an input reads and writes.",
  title: "Heading shown at the top of the component.",
  subtitle: "Secondary line under the title.",
  description: "Supporting text under the title or label.",
  caption: "Small muted line under the main content.",
  text: "The text content.",
  data: "Rows to plot or list; usually bound to a data-model path.",
  rows: "Row objects keyed by column key.",
  columns: "Column definitions or the number of columns.",
  items: "List of entries to render.",
  children: "Ids of child components (or a template over a data path).",
  child: "Id of the single child component.",
  onAction:
    'Event sent to the agent on click; context values may be { "@path" } bindings read at click time.',
  variant: "Visual variant.",
  tone: "Color tone that carries meaning (positive, negative, warning...).",
  format: "Number formatting for values and axes.",
  unit: "Unit appended to values (for example km or °C).",
  height: "Height in pixels.",
  options: "Choices as { value, label } pairs.",
  placeholder: "Hint shown while the field is empty.",
  hint: "Help text under the field.",
  icon: "Lucide icon name (kebab-case).",
  delta: "Change versus a previous period, for example +4.2%.",
  trend: "Direction of the change: up, down or flat.",
  markers: "Points with name, lat and lon.",
  places: "Places with name, lat, lon and optional address.",
  coordinates: "Route polyline as [lon, lat] pairs.",
  url: "Address of the image or video.",
  image: "Image URL.",
  name: "Name shown as the main label.",
  min: "Lowest allowed or shown value.",
  max: "Highest allowed or shown value.",
  step: "Increment between values.",
  stacked: "Stack series instead of grouping them side by side.",
  horizontal: "Lay bars out horizontally for long labels.",
  gap: "Space between children.",
  justify: "Distribution along the main axis.",
  align: "Alignment along the cross axis.",
  keys: "Keys to show as keyboard chips.",
  tags: "Short labels shown as chips.",
  series: "Numeric values for the sparkline.",
  sample: "Shows a Sample data badge when the numbers are illustrative.",
  links: "Flows as { source, target, value }.",
  currency: "ISO currency code used for formatting.",
};

function C({ children }: { children: React.ReactNode }) {
  return (
    <code className="whitespace-nowrap rounded bg-secondary px-1.5 py-0.5 font-mono text-[12px] text-foreground">
      {children}
    </code>
  );
}

const BINDINGS = (
  <>
    In A2UI 1.0 any value may also be a <C>{'{ "@path" }'}</C> binding into the
    surface data model or a <C>{'{ "@call" }'}</C> function call.
  </>
);

export default async function ComponentPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  if (isComponentName(name)) return <PlaygroundComponent name={name} />;
  if (isStandardName(name)) return <StandardComponent name={name} />;
  notFound();
}

/* ---------- the playground's own components ---------- */

function PlaygroundComponent({ name }: { name: ComponentName }) {
  const def = definitions[name];
  const sample = sampleFor(name);
  const props = propRows(name).map((p) => ({
    ...p,
    description: p.description ?? PROP_HINTS[p.name] ?? null,
  }));
  const usedBy = templatesUsing(name);
  const i = FLAT.indexOf(name);

  return (
    <div className="flex gap-12">
      <article className="min-w-0 max-w-[860px] flex-1">
        <Breadcrumb
          section={def.category}
          href={`/components#${CATEGORY_SLUG[def.category]}`}
          name={name}
        />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.02em]">
            {name}
          </h1>
          <span className="rounded-md border border-border bg-secondary/60 px-2 py-0.5 text-[12px] font-medium text-muted-foreground">
            {def.category}
          </span>
        </div>
        <p className="mt-2.5 max-w-[640px] text-[15.5px] leading-relaxed text-muted-foreground">
          {def.description}
        </p>

        {sample ? (
          <section id="preview" className="mt-8 scroll-mt-20">
            <ComponentTabs
              name={name}
              intrinsic={INTRINSIC.has(name)}
              wide={!!sample.wide}
              express={expressOf(name, sample)}
              definition={code(definitionSource(name))}
              renderer={code(rendererSource(name))}
            />
          </section>
        ) : null}

        <section id="props" className="mt-14 scroll-mt-20">
          <h2 className="text-[21px] font-semibold tracking-[-0.015em]">
            Props
          </h2>
          <p className="mt-2 text-[14px] text-muted-foreground">
            Generated from the Zod definition. {BINDINGS}
          </p>
          <PropsTable rows={props} />
        </section>

        <section id="templates" className="mt-14 scroll-mt-20">
          <h2 className="text-[21px] font-semibold tracking-[-0.015em]">
            Used by templates
          </h2>
          {usedBy.length ? (
            <>
              <p className="mt-2 text-[14px] text-muted-foreground">
                Fixed-schema templates that include {name}. Try them in the
                playground.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {usedBy.map((t) => (
                  <Link
                    key={t}
                    href="/playground"
                    className="rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-[13px] text-foreground/85 transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    {t}
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-[14px] text-muted-foreground">
              No fixed template uses {name} yet. The dynamic composer can still
              place it in any surface.
            </p>
          )}
        </section>

        <Pager prev={FLAT[i - 1]} next={FLAT[i + 1]} />
      </article>

      <OnThisPage
        links={[
          ...(sample ? [["#preview", "Preview"] as const] : []),
          ["#props", `Props (${props.length})`],
          ["#templates", "Used by templates"],
        ]}
      />
    </div>
  );
}

/* ---------- the Gen UI 2.0 standard components ---------- */

function StandardComponent({ name }: { name: string }) {
  const sample = sampleFor(name);
  const i = STANDARD_NAMES.indexOf(name);

  return (
    <div className="flex gap-12">
      <article className="min-w-0 max-w-[860px] flex-1">
        <Breadcrumb
          section="Standard components"
          href="/components#standard"
          name={name}
        />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.02em]">
            {name}
          </h1>
          <span className="rounded-md border border-border bg-secondary/60 px-2 py-0.5 text-[12px] font-medium text-muted-foreground">
            Gen UI 2.0 standard
          </span>
        </div>
        <p className="mt-2.5 max-w-[640px] text-[15.5px] leading-relaxed text-muted-foreground">
          {standardDescription(name)}
        </p>
        <p className="mt-3 max-w-[640px] text-[14px] leading-relaxed text-muted-foreground">
          One of the {STANDARD_NAMES.length} components in CopilotKit&apos;s{" "}
          <C>standardUI</C>. The playground&apos;s catalog extends it, so every
          agent here can use {name}.{" "}
          <a
            href={STANDARD_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-4"
          >
            Standard catalog docs
            <ArrowUpRight className="size-3.5" />
          </a>
        </p>

        {sample ? (
          <section id="preview" className="mt-8 scroll-mt-20">
            <ComponentTabs
              name={name}
              intrinsic={INTRINSIC.has(name)}
              wide={!!sample.wide}
              express={expressOf(name, sample)}
            />
          </section>
        ) : null}

        <section id="props" className="mt-14 scroll-mt-20">
          <h2 className="text-[21px] font-semibold tracking-[-0.015em]">
            Props
          </h2>
          <p className="mt-2 text-[14px] text-muted-foreground">
            Read from <C>standardUI.manifestComponents</C> in the installed{" "}
            <C>@copilotkit/react-core</C>. {BINDINGS}
          </p>
          <StandardProps name={name} />
        </section>

        <Pager prev={STANDARD_NAMES[i - 1]} next={STANDARD_NAMES[i + 1]} />
      </article>

      <OnThisPage
        links={[
          ...(sample ? [["#preview", "Preview"] as const] : []),
          ["#props", "Props"],
        ]}
      />
    </div>
  );
}

/* ---------- shared ---------- */

function Breadcrumb({
  section,
  href,
  name,
}: {
  section: string;
  href: string;
  name: string;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground"
    >
      <Link
        href="/components"
        className="transition-colors hover:text-foreground"
      >
        Components
      </Link>
      <ChevronRight className="size-3.5 flex-none opacity-60" />
      <Link
        href={href}
        className="truncate transition-colors hover:text-foreground"
      >
        {section}
      </Link>
      <ChevronRight className="size-3.5 flex-none opacity-60" />
      <span className="truncate text-foreground">{name}</span>
    </nav>
  );
}

function Pager({ prev, next }: { prev?: string; next?: string }) {
  const link =
    "flex h-9 min-w-0 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-medium text-foreground/85 transition-colors hover:bg-secondary hover:text-foreground";
  return (
    <nav
      aria-label="Pagination"
      className="mt-16 flex items-center justify-between gap-4 border-t border-border pt-6"
    >
      {prev ? (
        <Link href={`/components/${prev}`} className={link}>
          <ChevronLeft className="size-4 flex-none" />
          <span className="truncate">{prev}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={`/components/${next}`} className={link}>
          <span className="truncate">{next}</span>
          <ChevronRight className="size-4 flex-none" />
        </Link>
      ) : null}
    </nav>
  );
}

function OnThisPage({
  links,
}: {
  links: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <aside className="sticky top-[88px] hidden h-fit w-[180px] flex-none xl:block">
      <div className="text-[13px] font-medium text-foreground">
        On this page
      </div>
      <ul className="mt-3 space-y-2 text-[13px] text-muted-foreground">
        {links.map(([href, label]) => (
          <li key={href}>
            <a href={href} className="transition-colors hover:text-foreground">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
