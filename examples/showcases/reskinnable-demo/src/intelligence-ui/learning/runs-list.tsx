import { History, RefreshCw } from "lucide-react";
import { useLocation, useSearchParams } from "../shell/router";

import { CollectionPagination, DataTable } from "../ui/data-display";
import type { DataTableColumn } from "../ui/data-display";
import { Badge, EmptyState } from "../ui/feedback";
import type { BadgeVariant } from "../ui/feedback";
import { Button } from "../ui/primitives";

import type { LearningRun } from "./learning-api";
import type {
  AnalysisDisplayStatus,
  LearningContainerState,
} from "./learning-container-state";
import {
  analysisDisplayStatus,
  analysisLabel,
  learningTimestamp,
} from "./learning-container-state";
import styles from "./learning-page.module.css";

interface AnalysisResultsListProps {
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isRefreshing?: boolean;
  readonly onRetry: () => void;
  readonly runs: readonly LearningRun[];
  readonly state: LearningContainerState | null;
}

const pageSize = 10;

/** Sentence-case label and badge tone for each analysis lifecycle status. */
const statusBadge: Readonly<
  Record<
    AnalysisDisplayStatus,
    { readonly label: string; readonly variant: BadgeVariant }
  >
> = {
  analyzing: { label: "Analyzing", variant: "warning" },
  complete: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
  retrying: { label: "Retrying", variant: "warning" },
};

/** One table row; a type alias so it satisfies the DataTable row contract. */
type AnalysisRow = { readonly run: LearningRun };

/** Formats a nullable server count, or an em dash when none was recorded. */
function countCell(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString();
}

/** Columns read only fields the analysis record returns. */
const columns: readonly DataTableColumn<AnalysisRow>[] = [
  {
    cell: ({ run }) => (
      <span className={styles.analysisName}>
        <span title={run.id}>{analysisLabel(run.id)}</span>
        <Badge variant="outline">
          {run.triggerSource === "automatic" ? "Automatic" : "Manual"}
        </Badge>
      </span>
    ),
    header: "Analysis",
    id: "analysis",
  },
  {
    cell: ({ run }) => {
      const status = statusBadge[analysisDisplayStatus(run)];
      return (
        <span className={styles.analysisStatus}>
          <Badge dot variant={status.variant}>
            {status.label}
          </Badge>
          {run.status === "failed" && run.failureCode !== null ? (
            <code data-slot="identifier">{run.failureCode}</code>
          ) : null}
        </span>
      );
    },
    header: "Status",
    id: "status",
  },
  {
    cell: ({ run }) => countCell(run.evidenceThreadCount),
    header: "Threads",
    id: "threads",
  },
  {
    cell: ({ run }) => countCell(run.insightCount),
    header: "Insights",
    id: "insights",
  },
  {
    cell: ({ run }) => countCell(run.candidateCount),
    header: "Skill candidates",
    id: "candidates",
  },
  {
    cell: ({ run }) => (
      <time dateTime={run.createdAt}>{learningTimestamp(run.createdAt)}</time>
    ),
    header: "Created",
    id: "created",
  },
  {
    cell: ({ run }) =>
      run.completedAt ? (
        <time dateTime={run.completedAt}>
          {learningTimestamp(run.completedAt)}
        </time>
      ) : (
        "—"
      ),
    header: "Finished",
    id: "finished",
  },
];

/**
 * Renders the real, latest-100 analysis response as a single-line history table.
 *
 * @param props - Runs, their load state, and the refresh action.
 * @returns The analysis history section, or the reason it is empty.
 */
export function AnalysisResultsList(
  props: AnalysisResultsListProps,
): React.JSX.Element {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const parsedPage = Number(searchParams.get("analysisPage"));
  const requestedPage =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const pageCount = Math.max(1, Math.ceil(props.runs.length / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const paramsForPage = (nextPage: number): URLSearchParams => {
    const next = new URLSearchParams(searchParams);
    if (nextPage <= 1) next.delete("analysisPage");
    else next.set("analysisPage", String(nextPage));
    return next;
  };
  const hrefForPage = (nextPage: number): string => {
    const query = paramsForPage(nextPage).toString();
    return `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
  };

  if (!props.isLoading && props.error === null && props.runs.length === 0) {
    return (
      <EmptyState
        description={
          props.state === "setup"
            ? "Assign this space ID in your Runtime, then analyze the Threads it collects."
            : props.state === "ready" || props.state === "collecting"
              ? "Analyze the collected Threads when you are ready, and each analysis will appear here with what it found."
              : "Completed analyses appear here with what each one found."
        }
        headingLevel={2}
        icon={<History />}
        title="No analysis results yet"
        variant="collection"
      />
    );
  }

  const rows: readonly AnalysisRow[] = props.runs
    .slice((page - 1) * pageSize, page * pageSize)
    .map((run) => ({ run }));
  const missingEvidence = rows.some(
    ({ run }) => run.evidenceThreadCount == null,
  );

  return (
    <section
      aria-label="Analysis history"
      aria-busy={props.isLoading || props.isRefreshing}
      className={styles.analysisHistory}
      id="analysis-history"
    >
      <div className={styles.analysisHistoryToolbar}>
        <div className={styles.analysisHistoryHeading}>
          <h2>Analysis history</h2>
          {!props.isLoading && props.error === null && missingEvidence ? (
            <p>Threads shows “—” when an analysis did not record its count.</p>
          ) : null}
        </div>
        {props.isRefreshing ? (
          <span className={styles.analysisRefreshing} role="status">
            Refreshing…
          </span>
        ) : null}
        <Button
          aria-disabled={props.isLoading || props.isRefreshing}
          aria-label="Refresh analysis history"
          onClick={() => {
            if (!props.isLoading && !props.isRefreshing) props.onRetry();
          }}
          size="icon"
          variant="outline"
        >
          <RefreshCw aria-hidden="true" size={16} />
        </Button>
      </div>
      {props.isLoading ? (
        <p className={styles.status} role="status">
          Loading analysis results…
        </p>
      ) : null}
      {props.error !== null ? (
        <div className={styles.errorState}>
          <p className={styles.error} role="alert">
            {props.error}
          </p>
          <Button
            aria-disabled={props.isRefreshing}
            onClick={() => {
              if (!props.isRefreshing) props.onRetry();
            }}
            size="sm"
            variant="outline"
          >
            Retry analysis results
          </Button>
        </div>
      ) : null}
      {!props.isLoading && props.error === null ? (
        <div className={styles.analysisTable}>
          <DataTable
            ariaLabel="Analysis history"
            columns={columns}
            rowKey={({ run }) => run.id}
            rows={rows}
            scrollRegionLabel="Analysis history results"
          />
        </div>
      ) : null}
      {!props.isLoading && props.error === null && props.runs.length === 100 ? (
        <p className={styles.analysisCoverage}>
          Showing the latest 100 analyses returned by this space.
        </p>
      ) : null}
      {!props.isLoading && props.error === null ? (
        <CollectionPagination
          hrefForPage={hrefForPage}
          label="Analyses"
          onPageChange={(nextPage) =>
            setSearchParams(paramsForPage(nextPage), {
              preventScrollReset: true,
            })
          }
          page={page}
          pageSize={pageSize}
          total={props.runs.length}
        />
      ) : null}
    </section>
  );
}
