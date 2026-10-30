/**
 * The /evals tables, from what `pnpm evals` wrote (src/data/evals.json).
 *
 * Every run and task is shown. A request the provider never answered (a rate
 * limit, a server error, no connection) is marked "no answer" and left out of
 * that run's scores, since it says nothing about the model; a run with no
 * answer at all shows as not run. A labelled run (a mock model checking the
 * harness) shows the label instead of model names and no per-task scores.
 */
import { cn } from "@/lib/utils";

export type EvalTask = { id: string; prompt: string; expect: string[][] };
export type EvalTaskResult = { id: string; valid: boolean; problem?: string; choice: number; used: string[]; composeMs: number; outputChars: number };
export type EvalRun = { model: string; label: string; composer: string; format: string; skipped?: string; tasks: EvalTaskResult[] };
export type EvalData = { ranAt: string; label?: string; skill?: { name: string; components: number }; tasks: EvalTask[]; runs: EvalRun[] };

const pct = (n: number) => `${Math.round(n * 100)}%`;
const ms = (n: number | null) => (n == null ? "n/a" : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(2)} s`);
const chars = (n: number | null) => (n == null ? "n/a" : `${n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n} ch`);
const formatName = (f: string) => (f === "express" ? "Express" : "JSON");
/** The same median `pnpm evals` uses: positive values only. */
const median = (xs: number[]) => {
  const s = xs.filter((x) => x > 0).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

const UNREACHABLE = /connection error|ECONNREFUSED|ENOTFOUND|fetch failed|socket hang up/i;

/** The provider never answered: an HTTP error status or no connection. */
const noAnswer = (t: EvalTaskResult) => !t.valid && t.outputChars === 0 && (/^[45]\d\d\b/.test(t.problem ?? "") || UNREACHABLE.test(t.problem ?? ""));

/** A problem in words a visitor reads, never a raw provider error body. */
export function plainProblem(problem = ""): string {
  const status = /^([45]\d\d)\b/.exec(problem)?.[1];
  if (status === "429") return "Rate limited by the provider (429)";
  if (status) return `The provider returned an error (${status})`;
  if (UNREACHABLE.test(problem)) return "Could not reach the model server";
  return problem.length > 140 ? `${problem.slice(0, 140)}…` : problem;
}

function plainSkip(run: EvalRun): string {
  if (/_API_KEY/.test(run.skipped ?? "")) return "No API key for this model was set when the evals ran.";
  if (run.model === "gemma") return "Gemma runs on a local server, and none was set up for this run.";
  return run.skipped ?? "";
}

export function scoreRun(run: EvalRun) {
  const answered = run.tasks.filter((t) => !noAnswer(t));
  const unanswered = run.tasks.filter(noAnswer);
  const valid = answered.filter((t) => t.valid).length;
  return {
    answered: answered.length,
    valid,
    validRate: answered.length ? valid / answered.length : 0,
    choice: answered.length ? answered.reduce((n, t) => n + t.choice, 0) / answered.length : 0,
    medianMs: median(answered.map((t) => t.composeMs)),
    medianChars: median(answered.map((t) => t.outputChars)),
    unanswered: unanswered.length,
    /** Why the provider did not answer, as the end of a sentence. */
    why: unanswered.length ? plainProblem(unanswered[0].problem).replace(/^./, (c) => c.toLowerCase()) : "",
  };
}

/** Whether a run has scores to show: it ran, and the provider answered at least once. */
export const hasScores = (run: EvalRun) => !run.skipped && scoreRun(run).answered > 0;

function Meter({ value, detail }: { value: number; detail?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="h-1.5 w-16 flex-none overflow-hidden rounded-full bg-white/[0.08]">
        <span className="block h-full rounded-full bg-[var(--pg-fixed)]" style={{ width: `${value * 100}%` }} />
      </span>
      <span className="tabular-nums">{pct(value)}</span>
      {detail ? <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{detail}</span> : null}
    </span>
  );
}

/** A run's name: the model and its composer, or the label of a harness check. */
function RunName({ run, label }: { run: EvalRun; label?: string }) {
  if (label) return <span className="block font-medium">{label.charAt(0).toUpperCase() + label.slice(1)}</span>;
  return (
    <>
      <span className="block font-medium">{run.label}</span>
      <span className="mt-0.5 block font-mono text-[12.5px] text-muted-foreground">composer {run.composer}</span>
    </>
  );
}

function NotRun({ reason }: { reason: string }) {
  return (
    <>
      <span className="mr-2 rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-foreground/80">not run</span>
      {reason}
    </>
  );
}

/** One row per run: a table on a laptop, a card per run on a phone or tablet. */
export function EvalSummary({ data }: { data: EvalData }) {
  const rows = data.runs.map((r) => {
    const s = scoreRun(r);
    const notRun = r.skipped ? plainSkip(r) : s.answered === 0 ? `Every request failed before the model answered: ${s.why}.` : undefined;
    const partial = !notRun && s.unanswered ? `No answer to ${s.unanswered} of ${r.tasks.length}, not scored: ${s.why}` : undefined;
    return { r, s, notRun, partial, key: `${r.model}-${r.format}` };
  });
  return (
    <>
      <ul data-eval-cards className="grid gap-3 sm:grid-cols-2 lg:hidden">
        {rows.map(({ r, s, notRun, partial, key }) => (
          <li key={key} className="rounded-xl border border-border px-4 py-3.5 text-[14.5px]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <RunName run={r} label={data.label} />
              </div>
              <span className="flex-none font-mono text-[13px]">{formatName(r.format)}</span>
            </div>
            {notRun ? (
              <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
                <NotRun reason={notRun} />
              </p>
            ) : (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">Valid render</dt>
                  <dd className="mt-1">
                    <Meter value={s.validRate} detail={`${s.valid}/${s.answered}`} />
                  </dd>
                </div>
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">Component choice</dt>
                  <dd className="mt-1">
                    <Meter value={s.choice} />
                  </dd>
                </div>
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">Median time</dt>
                  <dd className="mt-1 font-mono text-[13px] tabular-nums">{ms(s.medianMs)}</dd>
                </div>
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">Median output</dt>
                  <dd className="mt-1 font-mono text-[13px] tabular-nums">{chars(s.medianChars)}</dd>
                </div>
              </dl>
            )}
            {partial ? <p className="mt-3 text-[12.5px] text-muted-foreground">{partial}</p> : null}
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-xl border border-border lg:block">
        <table data-eval-summary className="w-full min-w-[720px] text-left text-[14.5px]">
          <thead className="border-b border-border bg-white/[0.02] text-[13px] text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">{data.label ? "Run" : "Model"}</th>
              <th className="px-5 py-3 font-medium">Format</th>
              <th className="px-5 py-3 font-medium">Valid render</th>
              <th className="px-5 py-3 font-medium">Component choice</th>
              <th className="px-5 py-3 font-medium">Median time</th>
              <th className="px-5 py-3 font-medium">Median output</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, s, notRun, partial, key }) => (
              <tr key={key} className="border-b border-border align-top last:border-0">
                <td className="px-5 py-3.5">
                  <RunName run={r} label={data.label} />
                  {partial ? <span className="mt-1 block text-[12.5px] text-muted-foreground">{partial}</span> : null}
                </td>
                <td className="px-5 py-3.5 font-mono text-[13px]">{formatName(r.format)}</td>
                {notRun ? (
                  <td colSpan={4} className="px-5 py-3.5 text-[13.5px] text-muted-foreground">
                    <NotRun reason={notRun} />
                  </td>
                ) : (
                  <>
                    <td className="px-5 py-3.5">
                      <Meter value={s.validRate} detail={`${s.valid}/${s.answered}`} />
                    </td>
                    <td className="px-5 py-3.5">
                      <Meter value={s.choice} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[13px] tabular-nums">{ms(s.medianMs)}</td>
                    <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[13px] tabular-nums">{chars(s.medianChars)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function EvalTasks({ data }: { data: EvalData }) {
  const ran = data.runs.filter(hasScores);
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table data-eval-tasks className="w-full table-fixed text-left text-[13.5px]" style={{ minWidth: 300 + ran.length * 170 }}>
        <thead className="border-b border-border bg-white/[0.02] text-[12.5px] text-muted-foreground">
          <tr>
            <th className="w-[300px] px-5 py-3 font-medium">Task</th>
            {ran.map((r) => (
              <th key={`${r.model}-${r.format}`} className="px-4 py-3 font-medium">
                {r.label} <span className="font-mono">{formatName(r.format)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.tasks.map((t) => (
            <tr key={t.id} className="border-b border-border align-top last:border-0">
              <td className="px-5 py-3">
                <span className="text-foreground">{t.prompt}</span>
                <span className="mt-1 block font-mono text-[12px] text-muted-foreground">expects {t.expect.map((g) => g.join(" | ")).join(" + ")}</span>
              </td>
              {ran.map((r) => {
                const x = r.tasks.find((y) => y.id === t.id);
                const key = `${r.model}-${r.format}`;
                if (!x) return <td key={key} className="px-4 py-3 text-muted-foreground">-</td>;
                if (noAnswer(x))
                  return (
                    <td key={key} className="px-4 py-3">
                      <span className="inline-flex rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-muted-foreground">no answer</span>
                      <span className="mt-1.5 block font-mono text-[11.5px] leading-relaxed text-muted-foreground">{plainProblem(x.problem)}</span>
                    </td>
                  );
                const tone = !x.valid || x.choice === 0 ? "bad" : x.choice < 1 ? "some" : "ok";
                return (
                  <td key={key} className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[12px]",
                        tone === "ok" ? "bg-emerald-400/10 text-emerald-300" : tone === "some" ? "bg-amber-400/10 text-amber-300" : "bg-red-400/10 text-red-300",
                      )}
                    >
                      {x.valid ? pct(x.choice) : "invalid"}
                    </span>
                    <span className="mt-1.5 block break-words font-mono text-[11.5px] leading-relaxed text-muted-foreground" title={x.valid ? undefined : x.problem}>
                      {x.valid ? x.used.join(", ") : plainProblem(x.problem)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
