import type { ReactNode } from 'react';

import { CopyButton } from '../ui/data-display';

import type { LearningSkill } from './learning-api';
import { learningTimestamp } from './learning-container-state';
import { ChevronRightIcon } from './learning-icons';
import { SkillDelivery } from './skill-delivery';
import styles from './learning-page.module.css';

interface SkillsListProps {
  /** Pending Skill candidate review, rendered above the published Skills. */
  readonly candidates: ReactNode;
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
          className={styles.reviewBar}
        >
          <h3 id="skill-review-title">
            {props.pendingCandidateCount === 1
              ? '1 Skill candidate ready for review'
              : `${props.pendingCandidateCount} Skill candidates ready for review`}
          </h3>
          {props.candidates}
        </section>
      ) : null}
      {props.candidatesError !== null ? (
        <p className={styles.error} role="alert">
          {props.candidatesError}
        </p>
      ) : null}

      {props.isLoading ? (
        <p className={styles.status} role="status">
          Loading Skills…
        </p>
      ) : props.error !== null ? (
        <p className={styles.error} role="alert">
          {props.error}
        </p>
      ) : props.skills.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>No published Skills</strong>
          <span>
            Analyze Threads, then review and approve an eligible Skill
            candidate.
          </span>
        </div>
      ) : (
        <>
          <section
            aria-labelledby="apply-skills-title"
            className={styles.applySkills}
          >
            <div>
              <h3 id="apply-skills-title">Download published Skills</h3>
              <p>
                Save a local copy from a directory connected to this project.
              </p>
            </div>
            <pre
              className={styles.commandBox}
              tabIndex={0}
              aria-label="Skill download command"
            >
              <code>{command}</code>
            </pre>
            <CopyButton label="Copy command" value={command} />
          </section>
          <ul className={styles.recordList}>
            {props.skills.map((skill) => (
              <li key={skill.id}>
                <button
                  className={styles.skillRow}
                  data-status={skill.status}
                  onClick={() => props.onOpenSkill(skill)}
                  type="button"
                >
                  <span className={styles.rowBody}>
                    <span className={styles.skillName}>{skill.name}</span>
                    <span className={styles.skillDescription}>
                      {skill.description}
                    </span>
                    <span className={styles.insightMeta}>
                      <span>
                        {`Revision ${skill.revision} · `}
                        {skill.status === 'published' ? 'Published' : 'Retired'}
                      </span>
                      <time dateTime={skill.updatedAt}>
                        {learningTimestamp(skill.updatedAt)}
                      </time>
                    </span>
                  </span>
                  <span aria-hidden="true" className={styles.rowChevron}>
                    <ChevronRightIcon />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
