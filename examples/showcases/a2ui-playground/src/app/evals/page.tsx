import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { EvalSummary, EvalTasks, hasScores, type EvalData } from "@/components/evals/eval-results";
import { SiteHeader } from "@/components/site/site-header";
import { CodeBlock } from "@/components/start/code-block";
import results from "@/data/evals.json";

export const metadata: Metadata = {
  title: "Evals | A2UI Playground",
  description: "Per-model scores for composing A2UI 1.0 surfaces: valid-render rate, component choice, latency and payload size, for Gemini, Gemma and GPT in Express and JSON.",
};

const data = results as unknown as EvalData;

function C({ children }: { children: React.ReactNode }) {
  return <code className="rounded-[5px] bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.86em] text-foreground">{children}</code>;
}

const RUN = `# every model set up on this machine, Express and JSON
GEMINI_API_KEY=... OPENAI_API_KEY=... pnpm evals

# a local Gemma through Ollama
ollama pull gemma4:e4b && pnpm evals --models gemma

# a subset
pnpm evals --models gemini --formats express --tasks flights,weather

# a skill built on /skills: only its components, results in a file of their own
pnpm evals --skill ~/Downloads/a2ui-forms-skills-express.zip --out forms-evals.json`;

const ranAt = `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(data.ranAt))} UTC`;

export default function EvalsPage() {
  const composers = [...new Set(data.runs.filter(hasScores).map((r) => r.composer))];
  return (
    <div className="pg-root min-h-[100dvh] bg-black">
      <SiteHeader active="evals" />
      <main>
        <section className="landing-container pb-12 pt-20">
          <h1 className="max-w-[20ch] text-[44px] font-semibold leading-[1.05] tracking-[-0.02em] text-balance">Evaluate the catalog, per model</h1>
          {data.label ? (
            <div data-eval-label className="mt-8 flex max-w-[80ch] items-start gap-3.5 rounded-xl border border-amber-400/40 bg-amber-400/[0.08] px-5 py-4 text-amber-100">
              <TriangleAlert className="mt-1 size-5 flex-none text-amber-300" />
              <div>
                <p className="text-[18px] font-semibold leading-snug">These are not model results.</p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-amber-100/85">
                  This run used a {data.label}: a scripted stand-in that returns the same canned surfaces whatever it is asked. It checks the harness, not any model, so
                  no model is named below and per-task scores are hidden. Run <C>pnpm evals</C> with a Gemini key, an OpenAI key or a local Gemma for real scores.
                </p>
              </div>
            </div>
          ) : null}
          <p className="mt-5 max-w-[68ch] text-[16px] leading-relaxed text-muted-foreground">
            {data.tasks.length} {data.tasks.length === 1 ? "request" : "requests"}, each answered by the composer the playground runs, for every model and format. A surface counts as a{" "}
            <span className="text-foreground">valid render</span> when it passes CopilotKit&apos;s own <C>validateOperation</C>, the check the browser runs
            before it paints. <span className="text-foreground">Component choice</span> is the share of the components a good answer needs that the model
            picked. Tasks live in <C>src/evals/tasks.ts</C>, results in <C>src/data/evals.json</C>.
          </p>
          <dl data-eval-meta className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-[14px]">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Ran</dt>
              <dd className="font-mono text-[13px] leading-[21px]">{ranAt}</dd>
            </div>
            {!data.label && composers.length ? (
              <div className="flex min-w-0 gap-2">
                <dt className="flex-none text-muted-foreground">Composer models</dt>
                <dd className="min-w-0 font-mono text-[13px] leading-[21px]">
                  {composers.map((c, i) => (
                    <Fragment key={c}>
                      <span className="whitespace-nowrap">{c}</span>
                      {i < composers.length - 1 ? ", " : ""}
                    </Fragment>
                  ))}
                </dd>
              </div>
            ) : null}
            {data.skill ? (
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Skill</dt>
                <dd className="font-mono text-[13px] leading-[21px]">
                  {data.skill.name}, {data.skill.components} components
                </dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="border-t border-border">
          <div className="landing-container py-14">
            <EvalSummary data={data} />
            <p className="mt-3 max-w-[80ch] text-[13.5px] leading-relaxed text-muted-foreground">
              A request the provider never answered, such as a rate limit, shows as no answer and is not scored. Median time is from the request to the finished
              surface; median output is the characters the model wrote.
            </p>
          </div>
        </section>

        <section className="border-t border-border">
          <div className="landing-container py-14">
            <h2 className="text-[22px] font-semibold tracking-tight">Per task</h2>
            {data.label ? (
              <p className="mt-2 max-w-[68ch] text-[14.5px] leading-relaxed text-muted-foreground">
                Hidden for this run: a {data.label} answers every task with the same few canned surfaces, so its per-task scores say nothing about the tasks.
              </p>
            ) : data.runs.some(hasScores) ? (
              <>
                <p className="mt-2 text-[14.5px] text-muted-foreground">The components each answer used. Green covers every expected group, amber some, red none or an invalid render.</p>
                <div className="mt-6">
                  <EvalTasks data={data} />
                </div>
              </>
            ) : (
              <p className="mt-2 text-[14.5px] text-muted-foreground">No model answered in this run.</p>
            )}
          </div>
        </section>

        <section className="border-t border-border">
          <div className="landing-container grid gap-8 py-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-4">
            <div>
              <h2 className="text-[22px] font-semibold tracking-tight">Run them yourself</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                Models without a key or a server show as not run. Add tasks for your own catalog, or evaluate a skill you{" "}
                <Link href="/skills" className="text-foreground underline underline-offset-4">
                  built
                </Link>
                : <C>--skill</C> gives the composer only that skill&apos;s components, in JSON, and a surface that uses anything else does not count as valid.
              </p>
              <Link href="/playground" className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground">
                Try a model in the playground <ArrowRight className="size-4" />
              </Link>
            </div>
            <CodeBlock code={RUN} file="terminal" lang="sh" />
          </div>
        </section>
      </main>
    </div>
  );
}
