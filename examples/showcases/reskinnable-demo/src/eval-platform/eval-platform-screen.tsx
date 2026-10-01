"use client";

/**
 * "Benchline Evals": a stand-in for the customer's own eval platform, separate from
 * Intelligence and from Ledgerline. It shows their existing suite (GET
 * /api/learning/v1/evals) and the cases CopilotKit Intelligence exported into it
 * (GET /api/learning/v1/evals/import), which have not been run yet.
 */
import { useCallback, useEffect, useState } from "react";
import styles from "./eval-platform.module.css";

interface SuiteCase {
  readonly id: string;
  readonly query: string;
  readonly expected: string;
  readonly runs: readonly boolean[];
  readonly passRate: number;
  readonly lastResult: "pass" | "fail";
  readonly lastNote?: string;
}
interface Suite {
  readonly suite: string;
  readonly lastRunAt: number;
  readonly passRate: number;
  readonly cases: readonly SuiteCase[];
}
interface Imported {
  readonly id: string;
  readonly sourceCandidateId: string;
  readonly query: string;
  readonly checks: readonly string[];
  readonly importedAt: number;
}

const ago = (ms: number): string => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
};

export function EvalPlatformScreen() {
  const [suite, setSuite] = useState<Suite | null>(null);
  const [imported, setImported] = useState<readonly Imported[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, i] = await Promise.all([
        fetch("/api/learning/v1/evals", { cache: "no-store" }).then((r) =>
          r.json(),
        ),
        fetch("/api/learning/v1/evals/import", { cache: "no-store" }).then(
          (r) => r.json(),
        ),
      ]);
      setSuite(s as Suite);
      setImported(
        ((i as { imported?: Imported[] }).imported ?? []) as Imported[],
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  const failing = suite
    ? suite.cases.filter((c) => c.lastResult === "fail").length
    : 0;
  return (
    <div className={styles.app}>
      <header className={styles.top}>
        <span className={styles.logo} aria-hidden="true">
          B
        </span>
        <b>Benchline Evals</b>
        <span className={styles.crumb}>
          ledgerline / datasets / {suite?.suite ?? "…"}
        </span>
        <span className={styles.workspace}>Ledgerline workspace</span>
      </header>
      <div className={styles.body}>
        <nav className={styles.nav} aria-label="Benchline">
          <span className={styles.navOn}>Datasets</span>
          <span>Experiments</span>
          <span>Runs</span>
          <span>Settings</span>
        </nav>
        <main className={styles.main}>
          {error ? <p role="alert">Could not load the suite: {error}</p> : null}
          {suite ? (
            <>
              <section className={styles.head}>
                <div>
                  <h1>{suite.suite}</h1>
                  <p>{`${suite.cases.length + imported.length} cases · last run ${ago(suite.lastRunAt)}`}</p>
                </div>
                <div
                  className={`${styles.kpi} ${suite.passRate < 0.8 ? styles.bad : ""}`}
                >
                  <b>{`${Math.round(suite.passRate * 100)}%`}</b>
                  <span>Pass rate, last run</span>
                </div>
                <div className={styles.kpi}>
                  <b>{`${suite.cases.length - failing}/${suite.cases.length}`}</b>
                  <span>Passing</span>
                </div>
                {imported.length ? (
                  <div className={styles.kpi}>
                    <b>{imported.length}</b>
                    <span>Not yet run</span>
                  </div>
                ) : null}
                <button
                  type="button"
                  className={styles.run}
                  disabled
                  title="This stand-in does not run evals"
                >
                  Run suite
                </button>
              </section>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Case</th>
                      <th>Expected</th>
                      <th>Last 5 runs</th>
                      <th>Pass rate</th>
                      <th>Last result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {imported.map((c) => (
                      <tr
                        key={c.id}
                        className={styles.imported}
                        data-imported="true"
                      >
                        <td>
                          <div className={styles.q}>{c.query}</div>
                          <span className={styles.importBadge}>
                            Imported from CopilotKit Intelligence
                          </span>
                          <div
                            className={styles.note}
                          >{`${c.sourceCandidateId} · imported ${ago(c.importedAt)}`}</div>
                        </td>
                        <td className={styles.exp}>
                          <ul className={styles.checks}>
                            {c.checks.map((check, i) => (
                              <li key={`${i}-${check}`}>{check}</li>
                            ))}
                          </ul>
                        </td>
                        <td className={styles.note}>No runs yet</td>
                        <td className={styles.note}>-</td>
                        <td>
                          <span className={styles.notRun}>Not yet run</span>
                        </td>
                      </tr>
                    ))}
                    {suite.cases.map((c) => (
                      <tr
                        key={c.id}
                        className={
                          c.lastResult === "fail" && /priya/i.test(c.query)
                            ? styles.failing
                            : undefined
                        }
                      >
                        <td>
                          <div className={styles.q}>{c.query}</div>
                          <div className={styles.note}>{c.id}</div>
                        </td>
                        <td className={styles.exp}>{c.expected}</td>
                        <td>
                          <span className={styles.dots}>
                            {c.runs.map((r, i) => (
                              <i
                                key={i}
                                className={r ? styles.pass : styles.fail}
                                title={r ? "pass" : "fail"}
                              />
                            ))}
                          </span>
                        </td>
                        <td
                          className={
                            c.passRate >= 0.6
                              ? styles.pr
                              : `${styles.pr} ${styles.prBad}`
                          }
                        >{`${Math.round(c.passRate * 100)}%`}</td>
                        <td>
                          <span
                            className={
                              c.lastResult === "pass"
                                ? styles.resPass
                                : styles.resFail
                            }
                          >
                            {c.lastResult}
                          </span>
                          {c.lastNote ? (
                            <div className={styles.note}>{c.lastNote}</div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={styles.footer}>
                Benchline Evals is a stand-in for your own eval tool in this
                demo.
              </p>
            </>
          ) : !error ? (
            <p role="status">Loading…</p>
          ) : null}
        </main>
      </div>
    </div>
  );
}
