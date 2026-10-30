import { A2UI_VERSION } from "@copilotkit/shared";
import { CATALOG_ID } from "@/a2ui/catalog/ids";
import { MACROS } from "@/a2ui/macros/macros";
import { expandSample, MACRO_SAMPLES } from "@/a2ui/macros/samples";
import { MacroPreview } from "@/components/docs/macro-preview";
import { CodeBlock } from "@/components/start/code-block";
import { toExpress } from "@/agent/express";

export const metadata = {
  title: "Macros | A2UI Components",
  description:
    "A2UI 1.0 macros: one call from the model, expanded on the server into standard components, so the client needs no code for them.",
};

function C({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-[5px] bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.86em] text-foreground">
      {children}
    </code>
  );
}

const DEFINE = `import { z } from "zod";
import { defineMacro, h } from "@/a2ui/macros/macro";

export const FlightCard = defineMacro({
  name: "FlightCard",
  description: "Flight itinerary with a select button. One per flight option.",
  props: z.object({ airline: z.string(), from: z.string(), to: z.string(), price: z.string().optional() }),
  events: { onAction: { description: "Fires when the flight is selected.", parameters: z.object({}).passthrough() } },
  // Pure: props in, a tree of standard components out. Props may be bound ({"@path"}).
  expand: (p) =>
    h("Card", { gap: 3 },
      h("Row", { justify: "spaceBetween" }, h("Title", { text: p.from, size: "xl" }), h("Title", { text: p.to, size: "xl" })),
      h("Button", { label: "Select flight", variant: "primary", onClick: p.onAction })),
});`;

/** The sample call as the model writes it in Express: one line. */
function expressLine(name: string) {
  const call = MACRO_SAMPLES[name];
  try {
    const text = toExpress([
      {
        version: A2UI_VERSION,
        createSurface: {
          surfaceId: "s",
          catalogId: CATALOG_ID,
          components: [call],
        },
      } as never,
    ]);
    return text.split("\n").find((l) => l.startsWith("root =")) ?? text;
  } catch {
    return JSON.stringify(call);
  }
}

export default function MacrosPage() {
  return (
    <div className="max-w-[1100px]">
      <p className="font-mono text-[13px] text-muted-foreground">A2UI 1.0</p>
      <h1 className="mt-2 text-[36px] font-semibold tracking-[-0.02em]">
        Macros
      </h1>
      <p className="mt-4 max-w-[70ch] text-[15.5px] leading-relaxed text-muted-foreground">
        A macro is a high-level component the model writes in one call. The
        server expands it into Gen UI 2.0 standard components before anything
        reaches the browser, so the client renders plain A2UI and needs no code
        for it. The design follows the A2UI Python SDK&apos;s{" "}
        <C>MacroExpander</C>: macro schemas join the catalog the model reads,
        the expansion keeps the macro&apos;s id at its root and names the rest{" "}
        <C>{"<id>__<type>_<n>"}</C>, and macros may nest up to 16 levels. A
        macro can also load its own data: <C>{'WeatherReport("Lisbon")'}</C>{" "}
        fetches the forecast.
      </p>

      <div className="mt-12 flex flex-col gap-16">
        {MACROS.map((m) => {
          const expanded = expandSample(m.name);
          const ops = [
            {
              version: A2UI_VERSION,
              createSurface: {
                surfaceId: `macro-${m.name}`,
                catalogId: CATALOG_ID,
                components: expanded,
              },
            },
          ];
          const line = expressLine(m.name);
          return (
            <section
              key={m.name}
              id={m.name}
              data-macro={m.name}
              className="scroll-mt-24"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-[22px] font-semibold tracking-tight">
                  {m.name}
                </h2>
                <span className="font-mono text-[13px] text-muted-foreground">
                  1 call, {line.length} characters in Express, {expanded.length}{" "}
                  standard components on the wire
                </span>
              </div>
              <p className="mt-2 max-w-[75ch] text-[14.5px] leading-relaxed text-muted-foreground">
                {m.description}
              </p>
              <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
                <div className="flex min-w-0 flex-col gap-4">
                  <CodeBlock
                    code={line}
                    file="what the model writes (Express)"
                    lang="py"
                    className="[&_pre]:whitespace-pre-wrap [&_pre]:break-words"
                  />
                  <div className="rounded-xl border border-border bg-white/[0.02] px-4 py-3">
                    <p className="text-[13px] text-muted-foreground">
                      Expands into
                    </p>
                    <p className="mt-1.5 font-mono text-[12.5px] leading-relaxed text-foreground/85">
                      {Object.entries(
                        expanded.reduce<Record<string, number>>(
                          (n, c) => ({
                            ...n,
                            [c.component]: (n[c.component] ?? 0) + 1,
                          }),
                          {},
                        ),
                      )
                        .map(([c, n]) => (n > 1 ? `${c} x${n}` : c))
                        .join(", ")}
                    </p>
                  </div>
                </div>
                <MacroPreview ops={ops} name={m.name} />
              </div>
            </section>
          );
        })}
      </div>

      <section className="mt-20 grid gap-8 border-t border-border pt-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight">
            Write a macro
          </h2>
          <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
            Give it a name, a description the model reads, a Zod schema and an{" "}
            <C>expand</C> function that returns standard components. Add a{" "}
            <C>load</C> function to fetch its data on the server.{" "}
            <C>pnpm catalog:export</C> adds it to the model&apos;s catalog and
            to the generated skills.
          </p>
        </div>
        <CodeBlock code={DEFINE} file="src/a2ui/macros/macros.ts" />
      </section>
    </div>
  );
}
