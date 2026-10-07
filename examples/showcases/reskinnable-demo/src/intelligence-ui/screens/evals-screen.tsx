"use client";

/**
 * Eval candidates: generated from trajectories, for the customer to review and
 * export INTO their own eval platform. Intelligence is not an eval platform: no
 * suite, runs or pass rates here. "Your eval platform" imports the accepted
 * candidates into the /eval-platform stand-in; LangSmith and Braintrust are
 * file downloads in their dataset formats.
 */
import { Check, Download, FileUp, Upload, X } from "lucide-react";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import type { EvalCandidate } from "../data/contract";
import { downloadFile, learningV1 } from "../data/client";
import { useLearningRequest } from "../learning/use-learning-request";
import { Badge, StatusMessage } from "../ui/feedback";
import { IconButton } from "../ui/primitives";
import {
  IntelligenceShell,
  INTELLIGENCE_BASE,
} from "../shell/intelligence-shell";
import { Link } from "../shell/router";
import { WorkspacePageHeader } from "../shell/workspace-page-header";
import styles from "./intelligence-screens.module.css";

const TARGETS = [
  {
    id: "langsmith",
    name: "LangSmith",
    logo: "/intelligence-ui/logos/langsmith-wordmark.svg",
    h: 19,
    note: "Dataset examples: inputs, outputs, metadata",
  },
  {
    id: "braintrust",
    name: "Braintrust",
    logo: "/intelligence-ui/logos/braintrust-logo.svg",
    h: 18,
    note: "Dataset records: input, expected, metadata",
  },
  {
    id: "generic",
    name: "Your eval platform",
    logo: null,
    h: 0,
    note: "Imports the cases straight into your own eval tool",
  },
] as const;

function exportRows(target: string, rows: readonly EvalCandidate[]) {
  return rows.map((c) => {
    const meta = {
      id: c.id,
      sourceTrajectoryIds: c.sourceTrajectoryIds,
      sourceEventIds: c.sourceEventIds,
      exportedFrom: "CopilotKit Intelligence",
      project: "Ledgerline",
    };
    if (target === "langsmith")
      return {
        inputs: { query: c.query },
        outputs: { checks: c.checks },
        metadata: meta,
      };
    if (target === "braintrust")
      return { input: c.query, expected: c.checks, metadata: meta };
    return { query: c.query, checks: c.checks, ...meta };
  });
}

export function EvalsScreen() {
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState<ReactNode>(null);
  const loadSuite = useCallback(
    (signal: AbortSignal) => learningV1.evals(signal),
    [],
  );
  const loadCandidates = useCallback(
    (signal: AbortSignal) => learningV1.evalCandidates(signal),
    [],
  );
  const candidates = useLearningRequest(loadCandidates, refresh);
  const rows = candidates.status === "ready" ? candidates.data : [];
  const accepted = rows.filter((c) => c.status === "accepted");

  const review = async (id: string, decision: "accepted" | "rejected") => {
    try {
      await learningV1.reviewEvalCandidate(id, decision);
      setNotice(
        `Candidate ${id} ${decision === "accepted" ? "accepted for export" : "rejected"}.`,
      );
    } catch (error) {
      setNotice(
        `Review failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    setRefresh((n) => n + 1);
  };

  const exportTo = async (target: (typeof TARGETS)[number]) => {
    const n = `${accepted.length} eval ${accepted.length === 1 ? "candidate" : "candidates"}`;
    if (target.id === "generic") {
      try {
        const result = await learningV1.importToEvalPlatform(
          accepted.map((c) => ({
            id: c.id,
            query: c.query,
            checks: c.checks,
            sourceTrajectoryIds: c.sourceTrajectoryIds,
          })),
        );
        setNotice(
          result.sample ? (
            `Sample data: ${n} would be exported to your eval platform.`
          ) : (
            <>
              {`Exported ${accepted.length === 1 ? "1 eval" : `${accepted.length} evals`} to ${result.platform}. `}
              <a
                href="/eval-platform"
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: "underline" }}
              >
                {`Open ${result.platform}`}
              </a>
            </>
          ),
        );
      } catch (error) {
        setNotice(
          `Export failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }
    const file = `ledgerline-evals-${target.id}.jsonl`;
    downloadFile(
      file,
      `${exportRows(target.id, accepted)
        .map((r) => JSON.stringify(r))
        .join("\n")}\n`,
      "application/x-ndjson",
    );
    setNotice(
      `Exported ${n} for ${target.name} as ${file}. Import it in ${target.name} to run them.`,
    );
  };

  return (
    <IntelligenceShell
      section={{ label: "Eval candidates", to: `${INTELLIGENCE_BASE}/evals` }}
    >
      <section className="shell-page" aria-labelledby="evals-title">
        <WorkspacePageHeader
          headingLevel={1}
          title="Eval candidates"
          titleId="evals-title"
          description="Generated from your trajectories. Review each one, then export the accepted ones into your eval platform. Intelligence does not run or score evals."
        />
        {notice ? (
          <p role="status" className={styles.note}>
            {notice}
          </p>
        ) : null}

        <div className={styles.split}>
          <div className={styles.stack}>
            {candidates.status === "error" ? (
              <StatusMessage
                title="Eval candidates could not be loaded"
                variant="danger"
              >
                {candidates.message}
              </StatusMessage>
            ) : null}
            {candidates.status === "empty" ? (
              <StatusMessage title="No eval candidates yet" variant="info">
                Run an analysis in{" "}
                <Link to={`${INTELLIGENCE_BASE}/learning`}>
                  Automatic Learning
                </Link>{" "}
                to write them from captured trajectories.
              </StatusMessage>
            ) : null}
            {rows.map((c) => (
              <article key={c.id} className={styles.candidate}>
                <div>
                  <span className={styles.badges}>
                    <Badge variant="neutral">Candidate</Badge>
                    {(c as { exportedAt?: number }).exportedAt ? (
                      <Badge variant="success">
                        {`Exported to Benchline Evals ${new Date((c as { exportedAt?: number }).exportedAt as number).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                      </Badge>
                    ) : null}
                    <span
                      className={styles.mono}
                    >{`${c.id} · from ${c.sourceTrajectoryIds.length === 1 ? "1 trajectory" : `${c.sourceTrajectoryIds.length} trajectories`}`}</span>
                  </span>
                  <h3>{c.query}</h3>
                  <ul className={styles.checks}>
                    {c.checks.map((check, i) => (
                      <li key={`${i}-${check}`}>{check}</li>
                    ))}
                  </ul>
                  <div className={styles.evidence}>
                    {[...new Set(c.sourceEventIds)].map((eventId) => (
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
                  <Badge
                    variant={
                      c.status === "accepted"
                        ? "success"
                        : c.status === "rejected"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {c.status === "pending"
                      ? "Needs review"
                      : c.status === "accepted"
                        ? "Accepted"
                        : "Rejected"}
                  </Badge>
                  <div>
                    <IconButton
                      label={`Accept candidate ${c.id}`}
                      title="Accept"
                      size="sm"
                      variant={
                        c.status === "accepted" ? "primary" : "secondary"
                      }
                      onClick={() => void review(c.id, "accepted")}
                    >
                      <Check aria-hidden="true" size={15} />
                    </IconButton>
                    <IconButton
                      label={`Reject candidate ${c.id}`}
                      title="Reject"
                      size="sm"
                      variant={c.status === "rejected" ? "danger" : "secondary"}
                      onClick={() => void review(c.id, "rejected")}
                    >
                      <X aria-hidden="true" size={15} />
                    </IconButton>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <aside className={styles.exportCard} aria-label="Export to">
            <h3>Export to your eval platform</h3>
            <p
              className={styles.note}
            >{`${accepted.length} accepted ${accepted.length === 1 ? "candidate" : "candidates"}. LangSmith and Braintrust download as a dataset file; your eval platform receives them directly. It runs them; Intelligence only exports.`}</p>
            {TARGETS.map((target) => (
              <button
                key={target.id}
                type="button"
                className={styles.target}
                disabled={accepted.length === 0}
                aria-label={`Export to ${target.name}`}
                onClick={() => void exportTo(target)}
              >
                <span>
                  {target.logo ? (
                    <span className={styles.logoPlate}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- local official logo file */}
                      <img
                        className={styles.brandmark}
                        src={target.logo}
                        alt={target.name}
                        style={{ height: target.h }}
                      />
                    </span>
                  ) : (
                    <span className={styles.generic}>
                      <FileUp aria-hidden="true" size={18} />
                      Your eval platform
                    </span>
                  )}
                  <small>{target.note}</small>
                </span>
                {target.id === "generic" ? (
                  <Upload aria-hidden="true" size={16} />
                ) : (
                  <Download aria-hidden="true" size={16} />
                )}
              </button>
            ))}
          </aside>
        </div>
      </section>
    </IntelligenceShell>
  );
}
