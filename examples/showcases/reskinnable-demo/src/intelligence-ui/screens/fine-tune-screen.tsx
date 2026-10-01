"use client";

/**
 * Fine-tune: a follow-on screen. Exports a training dataset built from
 * trajectories in the format the chosen provider expects. No training runs here.
 */
import { useCallback, useState } from "react";
import type { FineTuneTarget } from "../data/contract";
import { downloadFile, learningV1 } from "../data/client";
import { useLearningRequest } from "../learning/use-learning-request";
import { StatusMessage } from "../ui/feedback";
import { Button } from "../ui/primitives";
import { IntelligenceShell, INTELLIGENCE_BASE } from "../shell/intelligence-shell";
import { WorkspacePageHeader } from "../shell/workspace-page-header";
import styles from "./intelligence-screens.module.css";

const PROVIDERS: readonly {
  id: FineTuneTarget;
  name: string;
  product: string;
  logo: string;
  height: number;
  blurb: string;
}[] = [
  { id: "thinking-machines", name: "Thinking Machines", product: "Tinker", logo: "/intelligence-ui/logos/thinking-machines.svg", height: 30, blurb: "Fine-tuning API for open-weight models. Takes chat-format JSONL." },
  { id: "sagemaker", name: "AWS SageMaker", product: "Amazon SageMaker AI", logo: "/intelligence-ui/logos/amazon-sagemaker-ai.svg", height: 44, blurb: "Fine-tune in your own AWS account. Takes chat-format JSONL from S3." },
];

export function FineTuneScreen() {
  const [target, setTarget] = useState<FineTuneTarget>("thinking-machines");
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback((signal: AbortSignal) => learningV1.fineTunePreview(target, signal), [target]);
  const preview = useLearningRequest(load);
  const sample = preview.status === "ready" ? preview.data.sample : [];
  const jsonl = `${sample.map((row) => JSON.stringify(row)).join("\n")}\n`;
  const provider = PROVIDERS.find((p) => p.id === target) ?? PROVIDERS[0];

  return (
    <IntelligenceShell section={{ label: "Fine-tune", to: `${INTELLIGENCE_BASE}/fine-tune` }}>
      <section className="shell-page" aria-labelledby="fine-tune-title">
        <WorkspacePageHeader
          headingLevel={1}
          title="Fine-tune with"
          titleId="fine-tune-title"
          description="Export a training dataset built from your trajectories, in the format your fine-tuning provider expects. Intelligence does not run training."
          actions={
            <Button
              variant="primary"
              disabled={sample.length === 0}
              onClick={() => {
                const file = `ledgerline-finetune-${target}.jsonl`;
                downloadFile(file, jsonl, "application/x-ndjson");
                setNotice(`Exported ${file} with ${sample.length} examples. No training was started.`);
              }}
            >
              Export JSONL
            </Button>
          }
        />
        {notice ? (
          <p role="status" className={styles.note}>
            {notice}
          </p>
        ) : null}
        <div className={styles.ftGrid}>
          {PROVIDERS.map((p) => (
            <button key={p.id} type="button" className={styles.ftTarget} aria-pressed={p.id === target} onClick={() => setTarget(p.id)}>
              <span className={styles.ftLogo}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local official logo file */}
                <img className={styles.brandmark} src={p.logo} alt={p.name} style={{ height: p.height }} />
              </span>
              <span>
                <b>
                  {p.name} <span style={{ fontWeight: 400, color: "var(--cpki-color-muted-foreground)" }}>{p.product}</span>
                </b>
                <small>{p.blurb}</small>
              </span>
            </button>
          ))}
        </div>
        <section aria-labelledby="dataset-title" style={{ display: "grid", gap: 12 }}>
          <h2 id="dataset-title" style={{ margin: 0, fontSize: "var(--cpki-font-size-3)" }}>
            {`Dataset preview · ${provider.product}`}
          </h2>
          {preview.status === "error" ? (
            <StatusMessage title="The preview could not be loaded" variant="danger">
              {preview.message}
            </StatusMessage>
          ) : null}
          {preview.status === "ready" ? (
            <p className={styles.note}>{`${preview.data.examples} examples · ${preview.data.format.toUpperCase()} · built from captured trajectories`}</p>
          ) : null}
          {preview.status === "ready" && sample.length === 0 ? (
            <StatusMessage title="No training examples yet" variant="info">
              Examples appear once a trajectory has a completed reference path and an analysis has run.
            </StatusMessage>
          ) : null}
          {sample.map((row, i) => (
            <div key={i} className={styles.example}>
              <div className={styles.exampleHead}>{`example ${i + 1} · ${row.messages.length} messages`}</div>
              <div className={styles.exampleBody}>
                {row.messages.map((m, j) => {
                  const calls = (m.tool_calls ?? []) as { name?: string; arguments?: unknown }[];
                  return (
                    <div key={j} className={styles.msg}>
                      <span className={styles.role}>{String(m.role)}</span>
                      <span>
                        {typeof m.content === "string" ? m.content : JSON.stringify(m.content)}
                        {calls.map((c, k) => (
                          <span key={k} className={styles.toolCall}>{`→ ${c.name}(${JSON.stringify(c.arguments)})`}</span>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      </section>
    </IntelligenceShell>
  );
}
