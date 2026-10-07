import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { Download, FileCode2 } from 'lucide-react';
import { Badge, EmptyState } from '../ui/feedback';

import { CopyButton } from '../ui/data-display';
import { Dialog } from '../ui/overlays';
import { Button } from '../ui/primitives';

import type { LearningSkill } from './learning-api';
import { learningTimestamp } from './learning-container-state';
import { SkillDelivery } from './skill-delivery';
import { SkillEntry, SkillEntryList } from './skill-entry';
import styles from './learning-page.module.css';

interface SkillsListProps {
  /**
   * Pending Skill candidate review, rendered above the published Skills. A
   * finished review reports its outcome sentence, shown under Published skills.
   */
  readonly candidates: (
    reviewFallbackRef: RefObject<HTMLElement | null>,
    reportOutcome: (outcome: string) => void,
  ) => ReactNode;
  readonly candidatesError: string | null;
  readonly containerId: string;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly onLoadDelivery?: (signal: AbortSignal) => Promise<boolean | null>;
  readonly onSetDelivery: (enabled: boolean) => Promise<void>;
  readonly onOpenSkill: (skill: LearningSkill) => void;
  readonly pendingCandidateCount: number;
  readonly skills: readonly LearningSkill[];
}

/**
 * Renders Skill candidate review and the Container's published Skills.
 *
 * Review sits on this tab rather than on its own because approving a candidate
 * is how a Skill gets published: the two halves are one task.
 *
 * @param props - Skills, review content, and load state.
 * @returns The Skills view.
 */
export function SkillsList(props: SkillsListProps): React.JSX.Element {
  const command = `copilotkit skills download ${props.containerId} --output ./learned-skills`;
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [reviewOutcome, setReviewOutcome] = useState('');
  const publishedHeadingRef = useRef<HTMLHeadingElement>(null);

  return (
    <>
      <SkillDelivery
        containerId={props.containerId}
        onLoadDelivery={props.onLoadDelivery}
        onSetDelivery={props.onSetDelivery}
      />
      {props.pendingCandidateCount > 0 ? (
        <section
          aria-labelledby="skill-review-title"
          className={styles.skillSection}
        >
          <div className={styles.sectionHead}>
            <h2 id="skill-review-title">Ready for review</h2>
            <Badge>{props.pendingCandidateCount}</Badge>
          </div>
          <p className={styles.sectionHint}>
            Review the evidence and proposed instructions before publishing.
          </p>
          {props.candidates(publishedHeadingRef, setReviewOutcome)}
        </section>
      ) : null}
      {props.candidatesError !== null ? (
        <p className={styles.error} role="alert">
          {props.candidatesError}
        </p>
      ) : null}

      <section
        aria-labelledby="published-skills-title"
        className={styles.skillSection}
      >
        <div className={styles.sectionHead}>
          <h2
            id="published-skills-title"
            ref={publishedHeadingRef}
            tabIndex={-1}
          >
            Published skills
          </h2>
          {!props.isLoading &&
          props.error === null &&
          props.skills.length > 0 ? (
            <Button
              onClick={() => setDownloadOpen(true)}
              size="sm"
              variant="ghost"
            >
              <Download aria-hidden="true" size={14} />
              Download
            </Button>
          ) : null}
        </div>
        {/* Mounted before any review so the outcome is announced; focus lands
            on the heading above once the reviewed row leaves the list. */}
        <p
          className={
            reviewOutcome ? styles.sectionHint : 'cpki-visually-hidden'
          }
          role="status"
        >
          {reviewOutcome}
        </p>
        {props.isLoading ? (
          <p className={styles.status} role="status">
            Loading Skills…
          </p>
        ) : props.error !== null ? (
          <p className={styles.error} role="alert">
            {props.error}
          </p>
        ) : props.skills.length === 0 ? (
          <EmptyState
            description="Analyze Threads, then review and approve an eligible Skill candidate."
            headingLevel={3}
            icon={<FileCode2 />}
            title="No published Skills"
            variant="collection"
          />
        ) : (
          <>
            <SkillEntryList aria-label="Published skills">
              {props.skills.map((skill) => (
                <li key={skill.id}>
                  <SkillEntry
                    dataStatus={skill.status}
                    detail={`Revision ${skill.revision} · ${
                      skill.status === 'published' ? 'Published' : 'Retired'
                    } ${learningTimestamp(skill.updatedAt)}`}
                    onClick={() => props.onOpenSkill(skill)}
                    status={
                      skill.status === 'published' ? (
                        <Badge dot variant="success">
                          Published
                        </Badge>
                      ) : (
                        <Badge dot variant="neutral">
                          Retired
                        </Badge>
                      )
                    }
                    title={skill.name}
                  />
                </li>
              ))}
            </SkillEntryList>
            <Dialog
              open={downloadOpen}
              onOpenChange={setDownloadOpen}
              title="Download published Skills"
              description="Run this command from a directory connected to your project."
              footer={<CopyButton label="Copy command" value={command} />}
            >
              <pre
                className={styles.commandBox}
                tabIndex={0}
                aria-label="Skill download command"
              >
                <code>{command}</code>
              </pre>
            </Dialog>
          </>
        )}
      </section>
    </>
  );
}
