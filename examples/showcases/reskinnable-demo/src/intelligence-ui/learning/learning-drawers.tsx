/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import { CodeBlock } from '../ui/data-display';
import { Badge } from '../ui/feedback';
import { cycleFocus, useModalInertness } from '../ui/overlays';
import { Button, IconButton } from '../ui/primitives';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from '../shell/router';

import type {
  LearningEvidenceReference,
  LearningInsight,
  LearningInsightEvidence,
  LearningSkill,
} from './learning-api';
import { learningTimestamp } from './learning-container-state';
import styles from './learning-drawers.module.css';

type InsightTabId = 'evidence' | 'skill';

const tabLabels: Readonly<Record<InsightTabId, string>> = {
  evidence: 'Evidence',
  skill: 'Proposed skill',
};

/** Renders the close glyph for the drawer header control. */
function CloseIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

/** Renders a directional chevron for the evidence pager. */
function ChevronIcon(props: {
  readonly direction: 'next' | 'previous';
}): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="16"
    >
      <path
        d={props.direction === 'next' ? 'm10 6 6 6-6 6' : 'm14 6-6 6 6 6'}
      />
    </svg>
  );
}

/** Maps a Skill lifecycle status to its human label. */
function skillStatusLabel(status: LearningSkill['status']): string {
  return status === 'published' ? 'Published' : 'Retired';
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

  return `${references} message ${references === 1 ? 'reference' : 'references'} across ${threads} ${threads === 1 ? 'Thread' : 'Threads'}`;
}

/**
 * Explains a citation that cannot be quoted, without denying it happened.
 *
 * @param entry - One cited Thread whose messages resolved to nothing.
 * @returns Copy naming how many messages were cited and why they are not shown.
 */
function evidenceGapCopy(entry: LearningInsightEvidence): string {
  const cited = `${entry.messageCount} cited ${entry.messageCount === 1 ? 'message' : 'messages'}`;
  if (entry.unavailable === 'snapshot-missing') {
    return `${cited}. The frozen transcript for this analysis is no longer stored, so the text cannot be shown.`;
  }
  if (entry.unavailable === 'snapshot-unreadable') {
    return `${cited}. The frozen transcript could not be read, so the text cannot be shown.`;
  }
  return `${cited}. None of them resolved inside the frozen transcript for this analysis.`;
}

/** Returns the tab-list step implied by an arrow key, or 0 for other keys. */
function arrowStep(key: string): number {
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return 1;
  }

  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return -1;
  }

  return 0;
}

/**
 * Renders the shared right-hand drawer chrome with dialog semantics.
 *
 * Genuinely modal, because the drawer covers the list it was opened from:
 * `aria-modal` would otherwise promise a screen reader that the rest of the
 * page is unreachable while a keyboard user could still Tab into content
 * hidden behind the panel. The scrim gives that promise a way to be true and
 * gives a pointer user the conventional click-away.
 */
function DrawerShell(props: {
  readonly children: React.ReactNode;
  readonly onClose: () => void;
  readonly title: string;
  readonly titleId: string;
  readonly wide?: boolean;
}): React.JSX.Element {
  const drawerRef = useRef<HTMLElement>(null);
  const portalRootRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  // Read through a ref so the document listener is bound once and still calls
  // the current handler.
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  useModalInertness(true, portalRootRef);

  useEffect(() => {
    openerRef.current = document.activeElement;
    drawerRef.current?.focus();

    /*
     * Bound on the document as well as on the panel: paging the evidence
     * browser to a boundary disables the button that was focused, focus falls
     * to `<body>`, and a key event from there never reaches the panel's own
     * handler. Escape has to keep working from wherever focus ended up.
     */
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('keydown', closeOnEscape);

      const opener = openerRef.current;
      // Only if the opener survived: an action that replaced its own trigger
      // must not throw focus at a detached node.
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return createPortal(
    <div ref={portalRootRef}>
      <div
        aria-hidden="true"
        className={styles.scrim}
        onClick={props.onClose}
      />
      <aside
        aria-labelledby={props.titleId}
        aria-modal="true"
        className={styles.drawer}
        data-wide={props.wide === true ? 'true' : 'false'}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            props.onClose();
            return;
          }
          if (drawerRef.current !== null) cycleFocus(event, drawerRef.current);
        }}
        ref={drawerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className={styles.head}>
          <h2 className={styles.headTitle} id={props.titleId}>
            {props.title}
          </h2>
          <IconButton
            label="Close detail"
            onClick={props.onClose}
            size="sm"
            variant="ghost"
          >
            <CloseIcon />
          </IconButton>
        </header>
        <div className={styles.body}>{props.children}</div>
      </aside>
    </div>,
    document.body,
  );
}

/**
 * Renders one evidence entry as a source Thread card.
 *
 * The wire carries Thread ids and message ids only. Nothing resolves a message
 * id to its body, so this browses Thread provenance and citation volume rather
 * than quoting text the system does not have.
 */
function EvidenceBrowser(props: {
  readonly baseRoute: string;
  readonly evidence: readonly LearningInsightEvidence[];
  readonly index: number;
  readonly onSelect: (index: number) => void;
  readonly state: 'error' | 'loading' | 'ready';
}): React.JSX.Element {
  const total = props.evidence.length;

  if (props.state === 'loading') {
    return (
      <p className={styles.evidenceEmpty} role="status">
        Loading the cited messages…
      </p>
    );
  }

  if (props.state === 'error') {
    return (
      <p className={styles.evidenceEmpty} role="alert">
        The cited messages could not be read. The Insight still cites its
        Threads; only the quoted text is missing.
      </p>
    );
  }

  if (total === 0) {
    return (
      <p className={styles.evidenceEmpty}>
        This Insight cites no Threads. Nothing was recorded to browse, so there
        is no source to open.
      </p>
    );
  }

  const entry = props.evidence[props.index];
  const threadLabel = entry.threadName ?? entry.threadId;

  return (
    <>
      <div className={styles.evidenceBrowser}>
        <div className={styles.evidenceHead}>
          <span>{`Evidence ${props.index + 1} of ${total}`}</span>
          {total > 1 ? (
            <div className={styles.evidenceNav}>
              <IconButton
                disabled={props.index === 0}
                label="Previous evidence"
                onClick={() => props.onSelect(props.index - 1)}
                size="sm"
                variant="ghost"
              >
                <ChevronIcon direction="previous" />
              </IconButton>
              <IconButton
                disabled={props.index === total - 1}
                label="Next evidence"
                onClick={() => props.onSelect(props.index + 1)}
                size="sm"
                variant="ghost"
              >
                <ChevronIcon direction="next" />
              </IconButton>
            </div>
          ) : null}
        </div>
        <div aria-live="polite" className={styles.evidenceQuotes}>
          {entry.cited.length === 0 ? (
            <p className={styles.evidenceMessageCount}>
              {evidenceGapCopy(entry)}
            </p>
          ) : (
            entry.cited.map((message) => (
              <blockquote className={styles.evidenceQuote} key={message.id}>
                <span className={styles.evidenceRole}>{message.role}</span>
                <p>{message.content}</p>
              </blockquote>
            ))
          )}
        </div>
        <div className={styles.evidenceFoot}>
          <div className={styles.evidenceSource}>
            <span className={styles.evidenceSourceLabel}>Source trajectory</span>
            <span className={styles.evidenceSourceName}>{threadLabel}</span>
          </div>
          {/* An Insight outlives the Threads it cites, and a link to one that
              has been deleted is worse than no link. */}
          {entry.threadPresent ? (
            <Link
              aria-label={`Open trajectory ${threadLabel}`}
              className={styles.evidenceLink}
              to={`${props.baseRoute}/threads/${encodeURIComponent(entry.threadId)}`}
            >
              Open trajectory
            </Link>
          ) : null}
        </div>
      </div>
      {total > 1 ? (
        <div
          aria-label="Evidence entries"
          className={styles.evidenceDots}
          role="group"
        >
          {props.evidence.map((reference, index) => (
            <button
              aria-current={index === props.index ? 'true' : undefined}
              aria-label={`Evidence ${index + 1}`}
              className={styles.evidenceDot}
              key={`${reference.threadId}:${index}`}
              onClick={() => props.onSelect(index)}
              type="button"
            />
          ))}
        </div>
      ) : null}
    </>
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
          variant={props.skill.status === 'published' ? 'success' : 'neutral'}
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
  readonly loadEvidence: (
    insightId: string,
    signal: AbortSignal,
  ) => Promise<readonly LearningInsightEvidence[]>;
  readonly onClose: () => void;
  readonly onOpenSkill: (skill: LearningSkill) => void;
  readonly proposedSkill: LearningSkill | undefined;
}): React.JSX.Element {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const panelId = `${baseId}-panel`;
  const headingId = `${baseId}-panel-heading`;

  const tabs: readonly InsightTabId[] =
    props.proposedSkill === undefined ? ['evidence'] : ['evidence', 'skill'];

  // Stamped with the Insight it belongs to so a host that swaps Insights into
  // one mounted drawer reopens on the first evidence entry, not the last one
  // the reader paged to in a different Insight.
  const [view, setView] = useState<{
    readonly index: number;
    readonly insightId: string;
    readonly tab: InsightTabId;
  }>({ index: 0, insightId: props.insight.id, tab: 'evidence' });

  const [resolved, setResolved] = useState<{
    readonly evidence: readonly LearningInsightEvidence[];
    readonly insightId: string;
    readonly state: 'error' | 'loading' | 'ready';
  }>({ evidence: [], insightId: props.insight.id, state: 'loading' });

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
    setResolved({ evidence: [], insightId, state: 'loading' });

    loadEvidenceRef.current(insightId, controller.signal).then(
      (evidence) => {
        if (controller.signal.aborted) return;
        // The loader is supplied by the caller, so a stub or a JS caller can
        // hand back something the signature forbids. Evidence is the point of
        // this panel, but a malformed answer must not take the drawer down.
        setResolved({
          evidence: Array.isArray(evidence) ? evidence : [],
          insightId,
          state: Array.isArray(evidence) ? 'ready' : 'error',
        });
      },
      () => {
        if (controller.signal.aborted) return;
        setResolved({ evidence: [], insightId, state: 'error' });
      },
    );

    return () => controller.abort();
  }, [insightId]);

  const evidenceState =
    resolved.insightId === insightId ? resolved.state : 'loading';
  const evidence = resolved.insightId === insightId ? resolved.evidence : [];

  const isSameInsight = view.insightId === insightId;
  const requestedTab = isSameInsight ? view.tab : 'evidence';
  const activeTab: InsightTabId = tabs.includes(requestedTab)
    ? requestedTab
    : 'evidence';

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
    if (event.key === 'Home') {
      event.preventDefault();
      focusTab(tabs[0]);
      return;
    }

    if (event.key === 'End') {
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

  return (
    <DrawerShell
      onClose={props.onClose}
      title="Insight detail"
      titleId={titleId}
      wide
    >
      <section className={styles.hero}>
        {props.sourceContext ? (
          <Link className={styles.evidenceLink} to={props.sourceContext.href}>
            {props.sourceContext.projectName} /{' '}
            {props.sourceContext.containerName}
          </Link>
        ) : null}
        {props.showSkillClassification !== false ? (
          <span
            className={styles.heroTag}
            data-variant={
              props.proposedSkill === undefined ? 'insight' : 'skill'
            }
          >
            {props.proposedSkill === undefined
              ? 'INSIGHT ONLY'
              : 'PROPOSED SKILL'}
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

      {/* An Insight with no proposed Skill has one view, and a tab strip
          holding a single tab is chrome that decides nothing. The heading
          inside the panel already names what is being shown. */}
      {tabs.length < 2 ? null : (
        <div
          aria-label="Insight detail views"
          className={styles.tabs}
          role="tablist"
        >
          {tabs.map((tabId) => (
            <button
              aria-controls={panelId}
              aria-selected={tabId === activeTab}
              className={styles.tab}
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
      )}

      {/* With no tab strip there is no tab to be a `tabpanel` for, and a
          `tabpanel` role without a `tablist` is invalid. The region falls back
          to a plain scrollable container named by its own heading. */}
      <div
        aria-labelledby={
          tabs.length < 2 ? headingId : `${baseId}-tab-${activeTab}`
        }
        className={styles.panel}
        id={panelId}
        role={tabs.length < 2 ? undefined : 'tabpanel'}
        tabIndex={0}
      >
        {activeTab === 'skill' && props.proposedSkill !== undefined ? (
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
  readonly containerId: string;
  readonly onClose: () => void;
  readonly skill: LearningSkill;
}): React.JSX.Element {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const usageId = `${baseId}-usage`;
  const downloadCommand = `copilotkit skills download ${props.containerId} --output ./learned-skills`;

  return (
    <DrawerShell
      onClose={props.onClose}
      title={props.skill.name}
      titleId={titleId}
    >
      <div className={styles.skillBody}>
        <div className={styles.badges}>
          <Badge>{`Revision ${props.skill.revision}`}</Badge>
          <Badge
            variant={props.skill.status === 'published' ? 'success' : 'neutral'}
          >
            {skillStatusLabel(props.skill.status)}
          </Badge>
        </div>

        <section className={styles.detailBlock}>
          <h3 className={styles.detailBlockTitle}>What this Skill does</h3>
          <p className={styles.detailBlockText}>{props.skill.description}</p>
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
