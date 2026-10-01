"use client";

/**
 * Eval candidates: a follow-on screen. Candidates are generated from
 * trajectories for the customer to review and export to THEIR eval platform.
 * Intelligence does not run, score or store evals; the customer's own suite is
 * shown only for context, framed as theirs. Composed from the copied
 * Intelligence pieces.
 */
import { useCallback, useState } from "react";
import type { EvalCandidate } from "../data/contract";
import { downloadFile, learningV1 } from "../data/client";
import { useLearningRequest } from "../learning/use-learning-request";
import { Badge, StatusMessage } from "../ui/feedback";
import { IconButton } from "../ui/primitives";
import { IntelligenceShell, INTELLIGENCE_BASE } from "../shell/intelligence-shell";
import { Link } from "../shell/router";
import { WorkspacePageHeader } from "../shell/workspace-page-header";
import styles from "./intelligence-screens.module.css";

const TARGETS = [
  { id: "langsmith", name: "LangSmith", logo: "/intelligence-ui/logos/langsmith-wordmark.svg", h: 19, note: "Dataset examples: inputs, outputs, metadata" },
  { id: "braintrust", name: "Braintrust", logo: "/intelligence-ui/logos/braintrust-logo.svg", h: 18, note: "Dataset records: input, expected, metadata" },
  { id: "generic", name: "Your eval platform", logo: null, h: 0, note: "Plain JSONL with query, checks and sources" },
] as const;

function exportRows(target: string, rows: readonly EvalCandidate[]) {
  return rows.map((c) => {
    const meta = { id: c.id, sourceTrajectoryIds: c.sourceTrajectoryIds, sourceEventIds: c.sourceEventIds, exportedFrom: "CopilotKit Intelligence", project: "Ledgerline" };
    if (target === "langsmith") return { inputs: { query: c.query }, outputs: { checks: c.checks }, metadata: meta };
    if (target === "braintrust") return { input: c.query, expected: c.checks, metadata: meta };
    return { query: c.query, checks: c.checks, ...meta };
  });
}

export function EvalsScreen() {
  const [tab, setTab] = useState<"candidates" | "suite">("candidates");
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const loadSuite = useCallback((signal: AbortSignal) => learningV1.evals(signal), []);
  const loadCandidates = useCallback((signal: AbortSignal) => learningV1.evalCandidates(signal), []);
  const suite = useLearningRequest(loadSuite);
  const candidates = useLearningRequest(loadCandidates, refresh);
  const rows = candidates.status === "ready" ? candidates.data : [];
  const accepted = rows.filter((c) => c.status === "accepted");

  const review = async (id: string, decision: "accepted" | "rejected") => {
    try {
      await learningV1.reviewEvalCandidate(id, decision);
      setNotice(`Candidate ${id} ${decision === "accepted" ? "accepted for export" : "rejected"}.`);
    } catch (error) {
      setNotice(`Review failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    setRefresh((n) => n + 1);
  };

  const exportTo = (target: (typeof TARGETS)[number]) => {
    const file = `ledgerline-evals-${target.id}.jsonl`;
    downloadFile(file, `${exportRows(target.id, accepted).map((r) => JSON.stringify(r)).join("\n")}\n`, "application/x-ndjson");
    setNotice(`Exported ${accepted.length} eval ${accepted.length === 1 ? "candidate" : "candidates"} for ${target.name === "Your eval platform" ? "your eval platform" : target.name} as ${file}. Import it there to run them.`);
  };

  return (
    <IntelligenceShell section={{ label: "Eval candidates", to: `${INTELLIGENCE_BASE}/evals` }}>
      <section className="shell-page" aria-labelledby="evals-title">
        <WorkspacePageHeader
          headingLevel={1}
          title="Eval candidates"
          titleId="evals-title"
          description="Candidates generated from your trajectories, for you to review and export to your eval platform. Intelligence does not run or score evals."
        />
        <nav className={styles.tabs} aria-label="Eval candidate views">
          {(
            [
              ["candidates", "Eval candidates", rows.length],
              ["suite", "Your eval platform · for context", suite.status === "ready" ? suite.data.cases.length : "—"],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? styles.tabActive : styles.tab}
              style={{ background: "none", border: 0, borderBottom: "2px solid", borderBottomColor: tab === id ? "currentColor" : "transparent", cursor: "pointer", font: "inherit" }}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              {label}
              <span className={styles.count}>{n}</span>
            </button>
          ))}
        </nav>
        {notice ? (
          <p role="status" className={styles.note}>
            {notice}
          </p>
        ) : null}

        {tab === "suite" ? (
          suite.status === "ready" ? (
            <div className={styles.evp}>
              <div className={styles.evpTop}>
                <b style={{ color: "#27272a" }}>In your eval platform</b>
                <span>/ ledgerline / datasets / {suite.data.suite}</span>
                <span style={{ marginLeft: "auto" }}>Imported for context. These are your evals and your runs; Intelligence did not run them.</span>
              </div>
              <div className={styles.evpHead}>
                <div>
                  <b style={{ fontSize: 16 }}>{suite.data.suite}</b>
                  <div style={{ fontSize: 12, color: "#71717a" }}>{`${suite.data.cases.length} cases`}</div>
                </div>
                <div className={`${styles.kpi} ${suite.data.passRate < 0.8 ? styles.kpiBad : ""}`}>
                  <b>{`${Math.round(suite.data.passRate * 100)}%`}</b>
                  <span>Pass rate in your platform</span>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Query</th>
                    <th>Expected</th>
                    <th>Your last runs</th>
                    <th>Your pass rate</th>
                    <th>Your last result</th>
                  </tr>
                </thead>
                <tbody>
                  {suite.data.cases.map((c) => (
                    <tr key={c.id} className={c.lastResult === "fail" && /priya/i.test(c.query) ? styles.failing : undefined}>
                      <td>{c.query}</td>
                      <td style={{ color: "#52525b" }}>{c.expected}</td>
                      <td>
                        <span className={styles.dots}>
                          {c.runs.map((r, i) => (
                            <i key={i} className={r ? undefined : styles.fail} />
                          ))}
                        </span>
                      </td>
                      <td>{`${Math.round(c.passRate * 100)}%`}</td>
                      <td>
                        <Badge variant={c.lastResult === "pass" ? "success" : "danger"}>{c.lastResult}</Badge>
                        <div style={{ fontSize: 12, color: "#71717a", marginTop: 4 }}>{c.lastNote}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p role="status">{suite.status === "error" ? suite.message : "Loading your eval platform's suite…"}</p>
          )
        ) : (
          <div className={styles.split}>
            <div className={styles.stack}>
              {candidates.status === "error" ? (
                <StatusMessage title="Eval candidates could not be loaded" variant="danger">
                  {candidates.message}
                </StatusMessage>
              ) : null}
              {candidates.status === "empty" ? (
                <StatusMessage title="No eval candidates yet" variant="info">
                  Run an analysis in <Link to={`${INTELLIGENCE_BASE}/learning`}>Automatic Learning</Link> to write them from captured trajectories.
                </StatusMessage>
              ) : null}
              {rows.map((c) => (
                <article key={c.id} className={styles.candidate}>
                  <div>
                    <span className={styles.badges}>
                      <Badge variant="neutral">Candidate</Badge>
                      <span className={styles.mono}>{`${c.id} · from ${c.sourceTrajectoryIds.length === 1 ? "1 trajectory" : `${c.sourceTrajectoryIds.length} trajectories`}`}</span>
                    </span>
                    <h3>{c.query}</h3>
                    <ul className={styles.checks}>
                      {c.checks.map((check) => (
                        <li key={check}>{check}</li>
                      ))}
                    </ul>
                    <div className={styles.evidence}>
                      {c.sourceEventIds.map((eventId) => (
                        <a
                          key={eventId}
                          href={`${INTELLIGENCE_BASE}/trajectories/${encodeURIComponent(c.sourceTrajectoryIds[0] ?? "")}?event=${encodeURIComponent(eventId)}`}
                        >
                          {eventId}
                        </a>
                      ))}
                    </div>
                  </div>
                  <div className={styles.review}>
                    <Badge variant={c.status === "accepted" ? "success" : c.status === "rejected" ? "danger" : "neutral"}>
                      {c.status === "pending" ? "Needs review" : c.status === "accepted" ? "Accepted" : "Rejected"}
                    </Badge>
                    <div>
                      <IconButton label={`Accept candidate ${c.id}`} title="Accept" size="sm" variant={c.status === "accepted" ? "primary" : "secondary"} onClick={() => void review(c.id, "accepted")}>
                        <span aria-hidden="true" className="material-symbols-rounded">check</span>
                      </IconButton>
                      <IconButton label={`Reject candidate ${c.id}`} title="Reject" size="sm" variant={c.status === "rejected" ? "danger" : "secondary"} onClick={() => void review(c.id, "rejected")}>
                        <span aria-hidden="true" className="material-symbols-rounded">close</span>
                      </IconButton>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <aside className={styles.exportCard} aria-label="Export to">
              <h3>Export to</h3>
              <p className={styles.note}>{`${accepted.length} accepted ${accepted.length === 1 ? "candidate" : "candidates"}. Exported as JSONL in the target's dataset format. Your eval platform runs them.`}</p>
              {TARGETS.map((target) => (
                <button key={target.id} type="button" className={styles.target} disabled={accepted.length === 0} aria-label={`Export to ${target.name}`} onClick={() => exportTo(target)}>
                  <span>
                    {target.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local official logo file
                      <img className={styles.brandmark} src={target.logo} alt={target.name} style={{ height: target.h }} />
                    ) : (
                      <span className={styles.generic}>
                        <span aria-hidden="true" className="material-symbols-rounded">
                          upload_file
                        </span>
                        Your eval platform
                      </span>
                    )}
                    <small>{target.note}</small>
                  </span>
                  <span aria-hidden="true" className="material-symbols-rounded">
                    download
                  </span>
                </button>
              ))}
            </aside>
          </div>
        )}
      </section>
    </IntelligenceShell>
  );
}
