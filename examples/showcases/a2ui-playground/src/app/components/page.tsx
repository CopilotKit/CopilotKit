import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { definitions } from "@/a2ui/catalog/definitions";
import { firstSentence } from "@/a2ui/catalog/prompt-trim";
import { MACROS } from "@/a2ui/macros/macros";
import { CATEGORY_ORDER, CATEGORY_SLUG, ALL_NAMES } from "@/components/docs/catalog-index";
import { DEFAULT_ROW_HEIGHT, FLOOR_OVERRIDE, INTRINSIC, ROW_HEIGHT, SCALE_OVERRIDE, TILE_FLOOR, TILE_LAYOUT, TILE_SCALE, type TileSize } from "@/components/docs/tile-sizes";
import { TilePreview } from "@/components/docs/live-preview";
import { STANDARD_DOCS_URL, STANDARD_NAMES, standardDescription } from "@/components/docs/standard-index";
import { cn } from "@/lib/utils";

/** 1 col on phones, 2 cols (w shrinks to one cell) below xl, the full 4-col bento from xl up. */
const SPAN: Record<TileSize, string> = {
  s: "col-span-1 row-span-1",
  w: "col-span-1 xl:col-span-2 row-span-1",
  t: "col-span-1 row-span-1 sm:row-span-2",
  l: "col-span-1 sm:col-span-2 row-span-1 sm:row-span-2",
};

const BLURB: Record<string, string> = {
  Layout: "Containers that arrange other components.",
  Content: "Text, media and code.",
  "Data display": "Numbers, people, tables and schedules.",
  Charts: "TanStack Charts, themed to the catalog.",
  Maps: "MapLibre with a keyless dark basemap.",
  Inputs: "Form controls that write back to the data model.",
  Feedback: "Alerts, tips, loading and empty states.",
  Domain: "Ready-made cards for common agent answers.",
};

export default function ComponentsOverview() {
  return (
    <div className="max-w-[1080px]">
      <header className="max-w-[680px]">
        <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.02em]">Components</h1>
        <p className="mt-3 text-[15.5px] leading-relaxed text-muted-foreground">
          The playground uses all{" "}
          <a href="#standard" className="text-foreground underline underline-offset-4">
            {STANDARD_NAMES.length} Gen UI 2.0 standard components
          </a>
          . On top of them it adds {ALL_NAMES.length} of its own across {CATEGORY_ORDER.length} categories, built on shadcn/ui, TanStack Charts and MapLibre, and{" "}
          <Link href="/components/macros" className="text-foreground underline underline-offset-4">
            {MACROS.length} macros
          </Link>{" "}
          that expand into standard components on the server. Each preview is a live A2UI surface, rendered from the JSON an agent would send.
        </p>
      </header>

      {CATEGORY_ORDER.map((cat) => {
        const tiles = TILE_LAYOUT[cat];
        return (
          <section key={cat} id={CATEGORY_SLUG[cat]} className="mt-14 scroll-mt-20">
            <div className="mb-4 flex items-baseline gap-3">
              <h2 className="text-[19px] font-semibold tracking-[-0.01em]">{cat}</h2>
              <span className="font-mono text-[12px] tabular-nums text-muted-foreground/70">{tiles.length}</span>
              <p className="ml-auto hidden text-[13px] text-muted-foreground sm:block">{BLURB[cat]}</p>
            </div>
            <div className="grid grid-flow-row-dense grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" style={{ gridAutoRows: `${ROW_HEIGHT[cat] ?? DEFAULT_ROW_HEIGHT}px` }}>
              {tiles.map(([name, size]) => (
                <div
                  key={name}
                  className={cn(
                    "docs-tile group relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-[oklch(1_0_0/16%)]",
                    SPAN[size],
                  )}
                >
                  <div className="min-h-0 flex-1">
                    <TilePreview name={name} scale={SCALE_OVERRIDE[name] ?? TILE_SCALE[size]} floor={FLOOR_OVERRIDE[name] ?? TILE_FLOOR[size]} center={INTRINSIC.has(name)} />
                  </div>
                  <div className="flex h-[58px] flex-none flex-col justify-center border-t border-border px-4">
                    <Link href={`/components/${name}`} className="docs-tile-name text-[13.5px] font-medium text-foreground/90 outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring">
                      {name}
                    </Link>
                    <div className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{definitions[name].description}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <section id="standard" className="mt-14 scroll-mt-20">
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[19px] font-semibold tracking-[-0.01em]">Standard components</h2>
          <span className="font-mono text-[12px] tabular-nums text-muted-foreground/70">{STANDARD_NAMES.length}</span>
          <p className="text-[13px] text-muted-foreground sm:ml-auto">
            Built into CopilotKit Gen UI 2.0 as <code className="font-mono text-[12px] text-foreground/85">standardUI</code>.{" "}
            <a href={STANDARD_DOCS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-4">
              Docs
              <ArrowUpRight className="size-3.5" />
            </a>
          </p>
        </div>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {STANDARD_NAMES.map((name) => (
            <li key={name} className="min-w-0">
              <Link
                href={`/components/${name}`}
                className="docs-tile block h-full rounded-xl border border-border bg-card px-4 py-3 outline-none transition-colors hover:border-[oklch(1_0_0/16%)] focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="docs-tile-name block text-[13.5px] font-medium text-foreground/90">{name}</span>
                <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-relaxed text-muted-foreground">{firstSentence(standardDescription(name))}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
