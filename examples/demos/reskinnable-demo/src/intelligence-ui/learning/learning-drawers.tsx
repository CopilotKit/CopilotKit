/* eslint-disable react-hooks/set-state-in-effect -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import { CodeBlock } from "../ui/data-display";
import { Badge } from "../ui/feedback";
import { ScrollArea } from "../ui/layout";
import { Sheet } from "../ui/overlays";
import { Button } from "../ui/primitives";
import { useEffect, useId, useRef, useState } from "react";
import type { RefObject } from "react";
import { Link } from "../shell/router";

import type {
  LearningEvidenceReference,
  LearningInsight,
  LearningInsightEvidence,
  LearningSkill,
} from "./learning-api";
import { learningTimestamp } from "./learning-container-state";
import styles from "./learning-drawers.module.css";
import { EvidenceBrowser } from "./learning-evidence-browser";
import { SupportingInsights } from "./supporting-insights";
import type { EvidenceLoader } from "./supporting-insights";

type InsightTabId = "evidence" | "skill";

const tabLabels: Readonly<Record<InsightTabId, string>> = {
  evidence: "Evidence",
  skill: "Proposed skill",
};

/** Maps a Skill lifecycle status to its human label. */
function skillStatusLabel(status: LearningSkill["status"]): string {
  return status === "published" ? "Published" : "Retired";
}

/**
 * Describes evidence volume, keeping cited messages and source Threads apart.
 *
 * The wire counts these separately: `evidence` groups messages by Thread, so
 * its length is a Thread-group count and never a citation count.
 */
function evidenceSummary(
  evidence: readonly LearningEvidenceReference[],
): string {
  const references = evidence.reduce(
    (total, reference) => total + reference.messageIds.length,
    0,
  );
  const threads = new Set(evidence.map((reference) => reference.threadId)).size;

  return `${references} message ${references === 1 ? "reference" : "references"} across ${threads} ${threads === 1 ? "Thread" : "Threads"}`;
}

/** Returns the tab-list step implied by an arrow key, or 0 for other keys. */
function arrowStep(key: string): number {
  if (key === "ArrowRight" || key === "ArrowDown") {
    return 1;
  }

  if (key === "ArrowLeft" || key === "ArrowUp") {
    return -1;
  }

  return 0;
}

/**
 * Renders Learning detail in the shared Radix Sheet. Radix owns modality,
 * dismissal, focus containment, and return focus.
 */
function DrawerShell(props: {
  readonly children: React.ReactNode;
  readonly closeRequested?: boolean;
  readonly onClose: () => void;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly title: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const openerRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  useEffect(() => {
    if (props.closeRequested) setOpen(false);
  }, [props.closeRequested]);

  return (
    <Sheet
      closeLabel="Close detail"
      focusPanel
      onExited={props.onClose}
      onOpenChange={setOpen}
      open={open}
      returnFocusRef={props.returnFocusRef ?? openerRef}
      side="right"
      title={props.title}
    >
      <header className={styles.head}>
        <h2 className={styles.headTitle}>{props.title}</h2>
      </header>
      <ScrollArea className={styles.bodyScroll} viewportClassName={styles.body}>
        {props.children}
      </ScrollArea>
    </Sheet>
  );
}

/** Renders the Skill an Insight proposes, with a hand-off to its detail. */
function ProposedSkillPanel(props: {
  readonly onOpenSkill: (skill: LearningSkill) => void;
  readonly skill: LearningSkill;
}): React.JSX.Element {
  return (
    <div className={styles.proposal}>
      <h4 className={styles.proposalName}>{props.skill.name}</h4>
      <p className={styles.proposalDescription}>{props.skill.description}</p>
      <div className={styles.badges}>
        <Badge>{`Revision ${props.skill.revision}`}</Badge>
        <Badge
          variant={props.skill.status === "published" ? "success" : "neutral"}
        >
          {skillStatusLabel(props.skill.status)}
        </Badge>
      </div>
      <Button
        aria-label={`Open Skill ${props.skill.name}`}
        className={styles.proposalAction}
        onClick={() => props.onOpenSkill(props.skill)}
        variant="primary"
      >
        Open Skill
      </Button>
    </div>
  );
}

/**
 * Renders one Insight in a right-hand detail drawer.
 *
 * The statement is a claim; the evidence panel is what makes it checkable, so
 * the cited messages are read on open and quoted verbatim. They come from the
 * run's own frozen transcript rather than the live Thread, which is why a
 * Thread that has since moved on cannot change what the Insight rests on.
 *
 * @param props The Insight, its proposed Skill if any, the project base route,
 *   the lazy evidence loader, and the close and open-Skill callbacks.
 * @returns The Insight detail drawer.
 */
export function InsightDrawer(props: {
  /** Hide the classification when the caller has not loaded Skill relationships. */
  readonly showSkillClassification?: boolean;
  readonly sourceContext?: {
    readonly projectName: string;
    readonly containerName: string;
    readonly href: string;
  };
  readonly baseRoute: string;
  readonly insight: LearningInsight;
  readonly closeRequested?: boolean;
  readonly loadEvidence: (
    insightId: string,
    signal: AbortSignal,
  ) => Promise<readonly LearningInsightEvidence[]>;
  readonly onClose: () => void;
  readonly onOpenSkill: (skill: LearningSkill) => void;
  readonly proposedSkill: LearningSkill | undefined;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}): React.JSX.Element {
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const headingId = `${baseId}-panel-heading`;

  const tabs: readonly InsightTabId[] =
    props.proposedSkill === undefined ? ["evidence"] : ["evidence", "skill"];

  // Stamped with the Insight it belongs to so a host that swaps Insights into
  // one mounted drawer reopens on the first evidence entry, not the last one
  // the reader paged to in a different Insight.
  const [view, setView] = useState<{
    readonly index: number;
    readonly insightId: string;
    readonly tab: InsightTabId;
  }>({ index: 0, insightId: props.insight.id, tab: "evidence" });

  const [resolved, setResolved] = useState<{
    readonly evidence: readonly LearningInsightEvidence[];
    readonly insightId: string;
    readonly state: "error" | "loading" | "ready";
  }>({ evidence: [], insightId: props.insight.id, state: "loading" });

  const tabButtons = useRef<Map<InsightTabId, HTMLButtonElement>>(new Map());

  // Held in a ref so a caller that rebuilds the loader on every render cannot
  // restart a read that is already in flight for this Insight.
  const loadEvidenceRef = useRef(props.loadEvidence);

  useEffect(() => {
    loadEvidenceRef.current = props.loadEvidence;
  }, [props.loadEvidence]);

  const insightId = props.insight.id;

  useEffect(() => {
    const controller = new AbortController();
    setResolved({ evidence: [], insightId, state: "loading" });

    loadEvidenceRef.current(insightId, controller.signal).then(
      (evidence) => {
        if (controller.signal.aborted) return;
        // The loader is supplied by the caller, so a stub or a JS caller can
        // hand back something the signature forbids. Evidence is the point of
        // this panel, but a malformed answer must not take the drawer down.
        setResolved({
          evidence: Array.isArray(evidence) ? evidence : [],
          insightId,
          state: Array.isArray(evidence) ? "ready" : "error",
        });
      },
      () => {
        if (controller.signal.aborted) return;
        setResolved({ evidence: [], insightId, state: "error" });
      },
    );

    return () => controller.abort();
  }, [insightId]);

  const evidenceState =
    resolved.insightId === insightId ? resolved.state : "loading";
  const evidence = resolved.insightId === insightId ? resolved.evidence : [];

  const isSameInsight = view.insightId === insightId;
  const requestedTab = isSameInsight ? view.tab : "evidence";
  const activeTab: InsightTabId = tabs.includes(requestedTab)
    ? requestedTab
    : "evidence";

  const requestedIndex = isSameInsight ? view.index : 0;
  const activeIndex =
    evidence.length === 0
      ? 0
      : Math.min(Math.max(requestedIndex, 0), evidence.length - 1);

  const selectTab = (tab: InsightTabId): void => {
    setView({ index: activeIndex, insightId, tab });
  };

  const selectEvidence = (index: number): void => {
    setView({ index, insightId, tab: activeTab });
  };

  const focusTab = (tab: InsightTabId): void => {
    selectTab(tab);
    tabButtons.current.get(tab)?.focus();
  };

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ): void => {
    if (event.key === "Home") {
      event.preventDefault();
      focusTab(tabs[0]);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      focusTab(tabs[tabs.length - 1]);
      return;
    }

    const step = arrowStep(event.key);

    if (step === 0) {
      return;
    }

    event.preventDefault();
    const current = tabs.indexOf(activeTab);
    focusTab(tabs[(current + step + tabs.length) % tabs.length]);
  };

  // An Insight with no proposed Skill has one view, and a tab strip holding a
  // single tab is chrome that decides nothing. The heading inside the panel
  // already names what is being shown.
  const tabStrip =
    tabs.length < 2 ? null : (
      <div
        aria-label="Insight detail views"
        className={styles.tabs}
        data-slot="tabs-list"
        role="tablist"
      >
        {tabs.map((tabId) => (
          <button
            aria-controls={panelId}
            aria-selected={tabId === activeTab}
            data-slot="tabs-trigger"
            id={`${baseId}-tab-${tabId}`}
            key={tabId}
            onClick={() => selectTab(tabId)}
            onKeyDown={handleTabKeyDown}
            ref={(node) => {
              if (node === null) {
                tabButtons.current.delete(tabId);
                return;
              }

              tabButtons.current.set(tabId, node);
            }}
            role="tab"
            tabIndex={tabId === activeTab ? 0 : -1}
            type="button"
          >
            {tabLabels[tabId]}
          </button>
        ))}
      </div>
    );

  return (
    <DrawerShell
      closeRequested={props.closeRequested}
      onClose={props.onClose}
      returnFocusRef={props.returnFocusRef}
      title="Insight detail"
    >
      <section className={styles.hero}>
        {props.sourceContext ? (
          <Link className={styles.evidenceLink} to={props.sourceContext.href}>
            {props.sourceContext.projectName} /{" "}
            {props.sourceContext.containerName}
          </Link>
        ) : null}
        {props.showSkillClassification !== false ? (
          <span className={styles.heroTag}>
            {props.proposedSkill === undefined ? (
              <Badge variant="neutral">Insight only</Badge>
            ) : (
              <Badge variant="accent">Proposed skill</Badge>
            )}
          </span>
        ) : null}
        <h3 className={styles.heroStatement}>{props.insight.statement}</h3>
        <p className={styles.heroImpact}>{props.insight.impact}</p>
        <div className={styles.heroMeta}>
          <span>{evidenceSummary(props.insight.evidence)}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={props.insight.createdAt}>
            {learningTimestamp(props.insight.createdAt)}
          </time>
        </div>
      </section>

      {tabStrip}

      {/* With no tab strip there is no tab to be a `tabpanel` for, and a
          `tabpanel` role without a `tablist` is invalid. The region falls back
          to a plain scrollable container named by its own heading. */}
      <div
        aria-labelledby={
          tabs.length < 2 ? headingId : `${baseId}-tab-${activeTab}`
        }
        className={styles.panel}
        id={panelId}
        role={tabs.length < 2 ? undefined : "tabpanel"}
        tabIndex={0}
      >
        {activeTab === "skill" && props.proposedSkill !== undefined ? (
          <>
            <h3 className={styles.panelHeading} id={headingId}>
              Proposed skill
            </h3>
            <ProposedSkillPanel
              onOpenSkill={props.onOpenSkill}
              skill={props.proposedSkill}
            />
          </>
        ) : (
          <>
            <h3 className={styles.panelHeading} id={headingId}>
              Source evidence
            </h3>
            <EvidenceBrowser
              baseRoute={props.baseRoute}
              evidence={evidence}
              index={activeIndex}
              onSelect={selectEvidence}
              state={evidenceState}
            />
          </>
        )}
      </div>
    </DrawerShell>
  );
}

/**
 * Renders one published Skill revision in a right-hand detail drawer.
 *
 * @param props The Skill, the Learning container id that scopes the download
 *   command, and the close callback.
 * @returns The Skill detail drawer.
 */
export function SkillDrawer(props: {
  readonly baseRoute: string;
  readonly loadEvidence: EvidenceLoader;
  readonly containerId: string;
  readonly onClose: () => void;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly skill: LearningSkill;
}): React.JSX.Element {
  const baseId = useId();
  const usageId = `${baseId}-usage`;
  const downloadCommand = `copilotkit skills download ${props.containerId} --output ./learned-skills`;

  return (
    <DrawerShell
      onClose={props.onClose}
      returnFocusRef={props.returnFocusRef}
      title={props.skill.name}
    >
      <div className={styles.skillBody}>
        <div className={styles.badges}>
          <Badge>{`Revision ${props.skill.revision}`}</Badge>
          <Badge
            variant={props.skill.status === "published" ? "success" : "neutral"}
          >
            {skillStatusLabel(props.skill.status)}
          </Badge>
        </div>

        <section className={styles.detailBlock}>
          <h3 className={styles.detailBlockTitle}>What this Skill does</h3>
          <p className={styles.detailBlockText}>{props.skill.description}</p>
        </section>

        <section className={styles.detailBlock}>
          <h3 className={styles.detailBlockTitle}>Supporting Insights</h3>
          {props.skill.supportingInsights === undefined ? (
            <p className={styles.detailBlockText}>
              Supporting Insights are unavailable on this server version.
            </p>
          ) : (
            <SupportingInsights
              baseRoute={props.baseRoute}
              insights={props.skill.supportingInsights}
              loadEvidence={props.loadEvidence}
            />
          )}
        </section>

        <section className={styles.detailBlock}>
          <h3 className={styles.detailBlockTitle}>Last updated</h3>
          <p className={styles.detailBlockText}>
            <time dateTime={props.skill.updatedAt}>
              {learningTimestamp(props.skill.updatedAt)}
            </time>
          </p>
        </section>

        <section className={styles.detailBlock}>
          <h3 className={styles.detailBlockTitle}>SKILL.md</h3>
          <div className={styles.skillSource}>
            <CodeBlock
              code={props.skill.skillMd}
              copyLabel="Copy SKILL.md"
              language="markdown"
            />
          </div>
        </section>

        <section aria-labelledby={usageId} className={styles.usage}>
          <h3 className={styles.usageHeading} id={usageId}>
            Use published Skills
          </h3>
          <p className={styles.usageText}>
            Run this command from a directory connected to this Intelligence
            project:
          </p>
          <CodeBlock code={downloadCommand} copyLabel="Copy download command" />
        </section>
      </div>
    </DrawerShell>
  );
}
