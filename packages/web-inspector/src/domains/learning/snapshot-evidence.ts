import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import type {
  InspectorLearningInsight,
  InspectorLearningTrajectoryEvidence,
} from "@copilotkit/shared";

const plural = (count: number, singular: string, pluralForm: string) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

/** Rows shown per evidence kind before the panel asks to show more. */
const EVIDENCE_PREVIEW_LIMIT = 10;

type EvidenceKind = "threads" | "trajectories";

const EVIDENCE_NOUNS: Record<EvidenceKind, readonly [string, string]> = {
  threads: ["Thread", "Threads"],
  trajectories: ["Trajectory", "Trajectories"],
};

const trajectoryTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Reads the creation time from a UUIDv7 Trajectory id, whose first 48 bits
 * are Unix milliseconds. Returns null for ids of any other version.
 */
const trajectoryCreatedAt = (trajectoryId: string): Date | null => {
  const hex = trajectoryId.replace(/-/g, "");
  if (!/^[0-9a-f]{12}7[0-9a-f]{19}$/i.test(hex)) return null;
  return new Date(Number.parseInt(hex.slice(0, 12), 16));
};

/**
 * "Showing 100 of 412 Trajectories" for each kind the response shortened,
 * or null when every cited source is listed.
 */
function evidenceCoverageLabel(
  insight: InspectorLearningInsight,
): string | null {
  if (!insight.evidenceTruncated) return null;
  const parts: string[] = [];
  if (insight.evidence.length < insight.totalThreadCount) {
    parts.push(
      `${insight.evidence.length} of ${plural(insight.totalThreadCount, ...EVIDENCE_NOUNS.threads)}`,
    );
  }
  const trajectoriesShown = insight.trajectoryEvidence?.length ?? 0;
  if (
    insight.totalTrajectoryCount !== undefined &&
    trajectoriesShown < insight.totalTrajectoryCount
  ) {
    parts.push(
      `${trajectoriesShown} of ${plural(insight.totalTrajectoryCount, ...EVIDENCE_NOUNS.trajectories)}`,
    );
  }
  return parts.length === 0 ? null : `Showing ${parts.join(" · ")}`;
}

/**
 * Labels the sources an Insight cites. Trajectories are named only when
 * cited, so Thread-only Insights and older Intelligence versions read as
 * before.
 */
export function evidenceCountLabel(insight: InspectorLearningInsight): string {
  const threads = plural(insight.totalThreadCount, "Thread", "Threads");
  const trajectoryCount =
    insight.totalTrajectoryCount ?? insight.trajectoryEvidence?.length ?? 0;
  if (trajectoryCount === 0) return threads;
  const trajectories = plural(trajectoryCount, "Trajectory", "Trajectories");
  return insight.totalThreadCount === 0
    ? trajectories
    : `${threads} · ${trajectories}`;
}

export interface EvidenceListOptions {
  /** Evidence groups showing every row, keyed by Insight id and kind. */
  readonly expanded: ReadonlySet<string>;
  readonly onToggleGroup: (key: string) => void;
  readonly onOpenThread: (threadId: string, messageId?: string) => void;
  readonly onOpenTrajectory: () => void;
}

/**
 * Lists one kind of evidence: the first rows with a toggle for the rest,
 * then one line counting the sources that are no longer available.
 */
function renderEvidenceGroup<
  T extends { readonly status: "available" | "unavailable" },
>(
  insightId: string,
  kind: EvidenceKind,
  entries: readonly T[],
  showHeading: boolean,
  options: EvidenceListOptions,
  renderRow: (entry: Extract<T, { status: "available" }>) => unknown,
) {
  if (entries.length === 0) return nothing;
  const available = entries.filter(
    (entry): entry is Extract<T, { status: "available" }> =>
      entry.status === "available",
  );
  const unavailable = entries.length - available.length;
  const key = `${insightId}:${kind}`;
  const expanded = options.expanded.has(key);
  const hidden = Math.max(0, available.length - EVIDENCE_PREVIEW_LIMIT);
  const [singular, pluralForm] = EVIDENCE_NOUNS[kind];
  return html`
    ${
      showHeading
        ? html`<h4 class="evidence-group-heading">${pluralForm}</h4>`
        : nothing
    }
    ${(expanded ? available : available.slice(0, EVIDENCE_PREVIEW_LIMIT)).map(
      renderRow,
    )}
    ${
      hidden > 0
        ? html`<button
            class="evidence-more"
            type="button"
            aria-expanded=${expanded}
            @click=${() => options.onToggleGroup(key)}
          >
            ${
              expanded
                ? `Show fewer ${pluralForm}`
                : `Show ${plural(hidden, `more ${singular}`, `more ${pluralForm}`)}`
            }
          </button>`
        : nothing
    }
    ${
      unavailable > 0
        ? html`<div class="evidence-unavailable">
            ${plural(unavailable, singular, pluralForm)}
            ${unavailable === 1 ? "is" : "are"} no longer available
          </div>`
        : nothing
    }
  `;
}

function renderTrajectoryEvidence(
  evidence: Extract<
    InspectorLearningTrajectoryEvidence,
    { status: "available" }
  >,
  options: EvidenceListOptions,
) {
  const createdAt = trajectoryCreatedAt(evidence.trajectoryId);
  const idTail = evidence.trajectoryId.slice(-8);
  return html`<a
    class="evidence-link"
    href=${evidence.url}
    target="_blank"
    rel="noopener noreferrer"
    title=${evidence.trajectoryId}
    @click=${() => options.onOpenTrajectory()}
  >
    ⌁
    ${
      createdAt
        ? `Trajectory · ${trajectoryTimeFormat.format(createdAt)}`
        : `Trajectory ${idTail}`
    }
    · ${plural(evidence.eventCount, "cited event", "cited events")}
    ${createdAt ? html`<small class="evidence-id">${idTail}</small>` : nothing}
    <span>Open Trajectory ↗</span>
  </a>`;
}

/** The coverage line, evidence rows, and shortened-response note of an Insight. */
export function renderInsightEvidence(
  insight: InspectorLearningInsight,
  options: EvidenceListOptions,
): TemplateResult {
  const threads = insight.evidence;
  const trajectories = insight.trajectoryEvidence ?? [];
  const mixed = threads.length > 0 && trajectories.length > 0;
  const coverage = evidenceCoverageLabel(insight);
  return html`
    ${coverage ? html`<p class="evidence-coverage">${coverage}</p>` : nothing}
    <div class="evidence-list">
      ${
        threads.length === 0 && trajectories.length === 0
          ? html`
              <div class="evidence-unavailable">Evidence is no longer available</div>
            `
          : html`${renderEvidenceGroup(
              insight.id,
              "threads",
              threads,
              mixed,
              options,
              (evidence) =>
                html`<button
                  class="evidence-link"
                  type="button"
                  @click=${() =>
                    options.onOpenThread(
                      evidence.threadId,
                      evidence.messageIds[0],
                    )}
                >
                  ⌁
                  ${
                    evidence.threadName ??
                    `Thread ${evidence.threadId.slice(0, 8)}`
                  }
                  <span>Open Thread →</span>
                </button>`,
            )}${renderEvidenceGroup(
              insight.id,
              "trajectories",
              trajectories,
              mixed,
              options,
              (evidence) => renderTrajectoryEvidence(evidence, options),
            )}`
      }
    </div>
    ${
      insight.evidenceTruncated && !coverage
        ? html`
            <p class="supporting-unavailable">Evidence response shortened</p>
          `
        : nothing
    }
  `;
}
