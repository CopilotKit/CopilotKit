"use client";

/**
 * Product Insights for Ledgerline: what Intelligence found in this week's
 * trajectories, as friction to remove, opportunities to take and wins to keep.
 * Each insight cites the trajectories it was mined from and, where Automatic
 * Learning acted on it, the skill. The findings are seeded
 * (../ledgerline/analytics-data.ts); today's captured trajectories and the
 * close-card-exceptions skill are read live, so the page follows the demo.
 */
import { useEffect, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  GraduationCap,
  Minus,
  Route as RouteIcon,
  UsersRound,
} from "lucide-react";
import { Badge } from "../ui/feedback";
import type { BadgeVariant } from "../ui/feedback";
import {
  IntelligenceShell,
  INTELLIGENCE_BASE,
} from "../shell/intelligence-shell";
import { Link } from "../shell/router";
import { WorkspacePageHeader } from "../shell/workspace-page-header";
import { learningV1 } from "../data/client";
import type { DemoSkill, TrajectorySummary } from "../data/contract";
import { LEDGERLINE_CONTAINER_ID } from "../ids";
import {
  ANALYTICS_RANGE,
  PRODUCT_INSIGHTS,
} from "../ledgerline/analytics-data";
import type {
  InsightKind,
  LiveCitation,
  ProductInsight,
} from "../ledgerline/analytics-data";
import styles from "./analytics-screen.module.css";

const KIND: Record<InsightKind, { label: string; variant: BadgeVariant }> = {
  friction: { label: "Friction", variant: "danger" },
  opportunity: { label: "Opportunity", variant: "warning" },
  win: { label: "Win", variant: "success" },
};

const TONE: Record<ProductInsight["metric"]["tone"], BadgeVariant> = {
  positive: "success",
  negative: "danger",
  neutral: "neutral",
};

const ARROW = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;

/** Where a skill lives: the Ledgerline Expenses Learning Space's Skills tab. */
const SKILLS_TO = `${INTELLIGENCE_BASE}/learning/${LEDGERLINE_CONTAINER_ID}/skills`;

const SEEDED = /^trj_s/;
/** A month-end card close, by what the person asked (the trajectory's title). */
const CLOSE = /\bclos(e|ing)\b/i;

/** Today's captured trajectories an insight cites. */
function citedLive(
  kinds: readonly LiveCitation[] | undefined,
  rows: readonly TrajectorySummary[],
) {
  if (!kinds) return [];
  const live = rows.filter(
    (t) => !SEEDED.test(t.trajectoryId) && CLOSE.test(t.title),
  );
  return live
    .filter(
      (t) =>
        (kinds.includes("failed-close") &&
          t.outcome === "agent_failed_user_completed") ||
        (kinds.includes("replayed-close") && t.outcome === "agent_succeeded"),
    )
    .map((t) => ({
      id: t.trajectoryId,
      label:
        t.outcome === "agent_succeeded"
          ? `${t.user.name}, closed with the learned skill`
          : `${t.user.name}, agent failed and the close was finished by hand`,
    }));
}

function InsightCard(props: {
  readonly insight: ProductInsight;
  readonly trajectories: readonly TrajectorySummary[];
  readonly skills: readonly DemoSkill[] | null;
}) {
  const i = props.insight;
  const Arrow = ARROW[i.metric.direction];
  const cited = [...citedLive(i.live, props.trajectories), ...i.trajectories];
  const learned = i.skill?.live
    ? props.skills?.find((s) => s.name === i.skill?.name)
    : null;
  const skill = !i.skill
    ? null
    : !i.skill.live
      ? i.skill
      : learned && learned.status !== "disabled"
        ? {
            name: learned.name,
            status:
              learned.status === "published"
                ? ("Published" as const)
                : ("Proposed" as const),
          }
        : null;
  return (
    <article className={styles.insight} aria-labelledby={`${i.id}-title`}>
      <div className={styles.insightMain}>
        <div className={styles.insightTop}>
          <Badge variant={KIND[i.kind].variant}>{KIND[i.kind].label}</Badge>
          <span>Detected {i.detectedAt}</span>
          {cited.length ? (
            <>
              <span>·</span>
              <span>
                {cited.length}{" "}
                {cited.length === 1 ? "cited trajectory" : "cited trajectories"}
              </span>
            </>
          ) : null}
        </div>
        <h2 id={`${i.id}-title`}>{i.title}</h2>
        <p>{i.finding}</p>
        {skill ? (
          <div className={styles.skill}>
            <GraduationCap aria-hidden="true" size={14} />
            <span>
              Automatic Learning: <code>{skill.name}</code>
            </span>
            <Badge
              variant={skill.status === "Published" ? "success" : "accent"}
            >
              {skill.status}
            </Badge>
            <Link to={SKILLS_TO}>Open skill</Link>
          </div>
        ) : null}
        {cited.length ? (
          <div className={styles.links}>
            {cited.map((t) => (
              <Link key={t.id} to={`${INTELLIGENCE_BASE}/trajectories/${t.id}`}>
                <RouteIcon aria-hidden="true" size={13} />
                Open trajectory: {t.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
      <aside className={styles.insightSide} aria-label="Measured impact">
        <div>
          <p className={styles.sideLabel}>{i.metric.label}</p>
          <p className={styles.sideValue}>{i.metric.value}</p>
          <Badge variant={TONE[i.metric.tone]}>
            <Arrow aria-hidden="true" size={11} />
            {i.metric.trend}
          </Badge>
        </div>
        <div>
          <p className={styles.sideLabel}>Affected users</p>
          <p className={styles.sideValue} style={{ fontSize: 18 }}>
            <UsersRound aria-hidden="true" size={16} />
            {i.affectedUsers.toLocaleString("en-US")}
          </p>
        </div>
      </aside>
    </article>
  );
}

export function InsightsScreen() {
  const [kind, setKind] = useState<InsightKind | "all">("all");
  const [trajectories, setTrajectories] = useState<TrajectorySummary[]>([]);
  const [skills, setSkills] = useState<DemoSkill[] | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    learningV1
      .trajectories(ac.signal)
      .then(setTrajectories)
      .catch((error: unknown) => {
        if (!ac.signal.aborted)
          console.error("[intelligence] could not read trajectories", error);
      });
    learningV1
      .skills(ac.signal)
      .then(setSkills)
      .catch((error: unknown) => {
        if (!ac.signal.aborted)
          console.error("[intelligence] could not read skills", error);
      });
    return () => ac.abort();
  }, []);
  const rows = PRODUCT_INSIGHTS.filter(
    (i) => kind === "all" || i.kind === kind,
  );
  const count = (k: InsightKind) =>
    PRODUCT_INSIGHTS.filter((i) => i.kind === k).length;
  const filters: { id: InsightKind | "all"; label: string; n: number }[] = [
    { id: "all", label: "All", n: PRODUCT_INSIGHTS.length },
    { id: "friction", label: "Friction", n: count("friction") },
    { id: "opportunity", label: "Opportunities", n: count("opportunity") },
    { id: "win", label: "Wins", n: count("win") },
  ];
  return (
    <IntelligenceShell section={{ label: "Product Insights" }}>
      <section
        className={`shell-page ${styles.page}`}
        aria-labelledby="insights-title"
      >
        <WorkspacePageHeader
          headingLevel={1}
          title="Product Insights"
          titleId="insights-title"
          description="What finance teams did with the Ledgerline agent this week, mined from their trajectories in the app and in ChatGPT"
          actions={
            <span className={styles.period}>
              <CalendarDays aria-hidden="true" size={15} />
              {ANALYTICS_RANGE}
            </span>
          }
        />
        <div
          className={styles.filters}
          role="group"
          aria-label="Filter insights"
        >
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              className={styles.filter}
              aria-pressed={kind === f.id}
              onClick={() => setKind(f.id)}
            >
              {f.label}
              <span className={styles.filterCount}>{f.n}</span>
            </button>
          ))}
        </div>
        <div className={styles.feed}>
          {rows.map((i) => (
            <InsightCard
              key={i.id}
              insight={i}
              trajectories={trajectories}
              skills={skills}
            />
          ))}
        </div>
      </section>
    </IntelligenceShell>
  );
}
