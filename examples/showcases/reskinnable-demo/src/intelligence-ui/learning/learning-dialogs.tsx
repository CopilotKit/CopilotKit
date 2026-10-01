import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cycleFocus, useModalInertness } from '../ui/overlays';
import { Button, IconButton } from '../ui/primitives';

import type {
  CreateLearningContainerInput,
  LearningContainer,
  LearningContainerStats,
  UpdateLearningContainerInput,
} from './learning-api';
import {
  containerState,
  learningTimestamp,
  readyThreadTarget,
} from './learning-container-state';
import styles from './learning-dialogs.module.css';

/** Lifecycle of one dialog submit, so pending and failed states cannot overlap. */
type DialogSubmission =
  | { readonly status: 'idle' }
  | { readonly status: 'pending' }
  | { readonly message: string; readonly status: 'error' };

/**
 * Turns a container name into a candidate stable id.
 *
 * @param value - Raw name text.
 * @returns A lowercase hyphenated slug, empty when nothing survives.
 */
/*
 * Container ids become path segments under `/learning`, and a few of those
 * segments already mean something else. A Container called `memories` would
 * route to User Memories for the rest of its life, so it is refused at the
 * point of naming rather than created and then unreachable.
 */
const routeReservedContainerIds: ReadonlySet<string> = new Set(['memories']);

function slugifyContainerId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

/**
 * Reads a thrown value as reader-facing copy.
 *
 * @param error - Rejection value from the submit callback.
 * @param fallback - Copy to use when the rejection carries no message.
 * @returns A message safe to render in the dialog.
 */
function submissionMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
}

/** Renders the close glyph for a dialog header button. */
function CloseGlyph(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={styles.closeIcon}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

/**
 * Describes when this Container was last analyzed, in absolute local time.
 *
 * A run that is still working has no completion to report, so it says so
 * rather than dating the analysis before it.
 *
 * @param progress - Evidence progress for the Container being analyzed.
 * @returns One short value for the summary cell.
 */
function lastAnalysisValue(progress: LearningContainerStats | null): string {
  if (progress === null) return 'Unknown';
  if (containerState(progress) === 'analyzing') {
    return 'In progress';
  }
  if (progress.lastSucceededAt === null) {
    return 'Never';
  }
  return learningTimestamp(progress.lastSucceededAt);
}

/** Renders the warning glyph beside limited-evidence copy. */
function WarningGlyph(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M12 3 2.7 20h18.6L12 3Z" />
      <path d="M12 9v5M12 17.5h.01" />
    </svg>
  );
}

interface LearningDialogFrameProps {
  readonly children: ReactNode;
  readonly footer: ReactNode;
  readonly heading: string;
  readonly headingId: string;
  /** Control that receives focus as soon as the dialog appears. */
  readonly initialFocusRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Widens the card for the three-cell analysis summary. */
  readonly wide?: boolean;
}

/**
 * Renders the shared modal chrome for the Learning dialogs.
 *
 * The element carries the `open` attribute instead of being opened through
 * `showModal()`: jsdom implements neither `showModal()` nor `close()`, and a
 * dialog whose visibility depended on them would behave differently under test
 * than in the product. Escape, focus containment, and background isolation are
 * therefore handled here.
 *
 * @param props - Heading, body, footer, and dismissal callbacks.
 * @returns The dialog chrome wrapped around a form.
 */
function LearningDialogFrame(
  props: LearningDialogFrameProps,
): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { initialFocusRef, onClose } = props;

  useModalInertness(true, dialogRef);

  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    initialFocusRef.current?.focus();

    /*
     * Bound on the document as well as on the dialog. These render with the
     * `open` attribute rather than through `showModal()`, so there is no top
     * layer and no browser-owned Escape. Submitting a form moves focus to
     * `<body>`, and from there a key event never reaches the dialog's own
     * handler, which left the only way out being the close button.
     */
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('keydown', closeOnEscape);

      // Only restore focus to an opener the page still owns; a create that
      // succeeded may have replaced the control that started this dialog.
      if (opener !== null && opener.isConnected) {
        opener.focus();
      }
    };
  }, [initialFocusRef, onClose]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (dialogRef.current !== null) {
      cycleFocus(event, dialogRef.current);
    }
  };

  return createPortal(
    <dialog
      aria-labelledby={props.headingId}
      aria-modal="true"
      className={styles.dialog}
      onKeyDown={handleKeyDown}
      open
      ref={dialogRef}
    >
      <form
        className={`${styles.dialogCard} ${props.wide === true ? styles.wideCard : ''}`}
        onSubmit={props.onSubmit}
      >
        <header className={styles.dialogHead}>
          <h2 id={props.headingId}>{props.heading}</h2>
          <IconButton label="Close" onClick={onClose} variant="ghost">
            <CloseGlyph />
          </IconButton>
        </header>
        <div className={styles.dialogBody}>{props.children}</div>
        <footer className={styles.dialogFoot}>{props.footer}</footer>
      </form>
    </dialog>,
    document.body,
  );
}

interface CreateContainerDialogProps {
  readonly onClose: () => void;
  readonly onCreate: (input: CreateLearningContainerInput) => Promise<void>;
  readonly open: boolean;
  /** Container ids already in use, refused before the request is sent. */
  readonly reservedIds?: readonly string[];
}

/**
 * Renders the new-Learning-container dialog.
 *
 * Nothing stays mounted while closed, so every open starts from empty fields
 * rather than from whatever the previous attempt left behind.
 *
 * @param props - Dismissal callback, create callback, and reserved ids.
 * @returns The create dialog while open, otherwise nothing.
 */
export function CreateContainerDialog(
  props: CreateContainerDialogProps,
): React.JSX.Element | null {
  if (!props.open) {
    return null;
  }

  return (
    <CreateContainerForm
      onClose={props.onClose}
      onCreate={props.onCreate}
      reservedIds={props.reservedIds ?? []}
    />
  );
}

interface CreateContainerFormProps {
  readonly onClose: () => void;
  readonly onCreate: (input: CreateLearningContainerInput) => Promise<void>;
  readonly reservedIds: readonly string[];
}

/**
 * Renders the create-container fields and their client-side guards.
 *
 * @param props - Dismissal callback, create callback, and reserved ids.
 * @returns The create dialog body.
 */
function CreateContainerForm(
  props: CreateContainerFormProps,
): React.JSX.Element {
  const fieldId = useId();
  const headingId = `${fieldId}-heading`;
  const nameId = `${fieldId}-name`;
  const containerIdId = `${fieldId}-id`;
  const containerIdHintId = `${containerIdId}-hint`;
  const focusId = `${fieldId}-focus`;
  const focusHintId = `${focusId}-hint`;
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [containerId, setContainerId] = useState('');
  const [isContainerIdEdited, setIsContainerIdEdited] = useState(false);
  const [promptContext, setPromptContext] = useState('');
  const [submission, setSubmission] = useState<DialogSubmission>({
    status: 'idle',
  });
  const isPending = submission.status === 'pending';

  const changeName = (value: string): void => {
    setName(value);
    // The id tracks the name only until someone takes it over by hand.
    if (!isContainerIdEdited) {
      setContainerId(slugifyContainerId(value));
    }
  };

  const changeContainerId = (value: string): void => {
    setIsContainerIdEdited(true);
    setContainerId(value);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedId = containerId.trim();
    if (trimmedName.length === 0 || trimmedId.length === 0) {
      return;
    }

    if (routeReservedContainerIds.has(trimmedId)) {
      setSubmission({
        message: `The space ID ${trimmedId} is reserved by a Learning URL. Choose another ID.`,
        status: 'error',
      });
      return;
    }

    if (props.reservedIds.includes(trimmedId)) {
      setSubmission({
        message: `The space ID ${trimmedId} is already in use. Choose another ID.`,
        status: 'error',
      });
      return;
    }

    setSubmission({ status: 'pending' });
    try {
      await props.onCreate({
        id: trimmedId,
        name: trimmedName,
        promptContext: promptContext.trim() || null,
      });
    } catch (error: unknown) {
      setSubmission({
        message: submissionMessage(
          error,
          'Could not create the Learning Space.',
        ),
        status: 'error',
      });
    }
  };

  return (
    <LearningDialogFrame
      footer={
        <>
          <Button onClick={props.onClose} variant="secondary">
            Cancel
          </Button>
          <Button disabled={isPending} type="submit" variant="primary">
            {isPending ? 'Creating space…' : 'Create space'}
          </Button>
        </>
      }
      heading="New Learning Space"
      headingId={headingId}
      initialFocusRef={nameRef}
      onClose={props.onClose}
      onSubmit={submit}
    >
      <div className={styles.formField}>
        <label htmlFor={nameId}>Name</label>
        <input
          id={nameId}
          maxLength={255}
          onChange={(event) => changeName(event.currentTarget.value)}
          placeholder="Airport lounge support"
          ref={nameRef}
          required
          value={name}
        />
      </div>
      <div className={styles.formField}>
        <label htmlFor={containerIdId}>Space ID</label>
        <input
          aria-describedby={containerIdHintId}
          id={containerIdId}
          maxLength={64}
          onChange={(event) => changeContainerId(event.currentTarget.value)}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="airport-lounge-support"
          required
          value={containerId}
        />
        <span className={styles.fieldHint} id={containerIdHintId}>
          Pass this ID when a thread starts.
        </span>
      </div>
      <div className={styles.formField}>
        <label htmlFor={focusId}>Automatic Learning focus</label>
        <textarea
          aria-describedby={focusHintId}
          id={focusId}
          maxLength={4000}
          onChange={(event) => setPromptContext(event.currentTarget.value)}
          placeholder="Focus on access rules, exceptions, and successful resolutions."
          rows={3}
          value={promptContext}
        />
        <span className={styles.fieldHint} id={focusHintId}>
          Optional. This guides what the analysis looks for across these
          Threads.
        </span>
      </div>
      {submission.status === 'error' ? (
        <p className={styles.dialogError} role="alert">
          {submission.message}
        </p>
      ) : null}
    </LearningDialogFrame>
  );
}

interface ContainerSettingsDialogProps {
  readonly container: LearningContainer;
  readonly onClose: () => void;
  readonly onSave: (input: UpdateLearningContainerInput) => Promise<void>;
  readonly open: boolean;
}

/**
 * Renders the Learning container settings dialog.
 *
 * The form is keyed by container id, so pointing the dialog at a different
 * Container re-reads the fields from that Container instead of showing the
 * previous one's values.
 *
 * @param props - Container to edit, dismissal callback, and save callback.
 * @returns The settings dialog while open, otherwise nothing.
 */
export function ContainerSettingsDialog(
  props: ContainerSettingsDialogProps,
): React.JSX.Element | null {
  if (!props.open) {
    return null;
  }

  return (
    <ContainerSettingsForm
      container={props.container}
      key={props.container.id}
      onClose={props.onClose}
      onSave={props.onSave}
    />
  );
}

interface ContainerSettingsFormProps {
  readonly container: LearningContainer;
  readonly onClose: () => void;
  readonly onSave: (input: UpdateLearningContainerInput) => Promise<void>;
}

/**
 * Renders the editable Container settings fields.
 *
 * @param props - Container to edit, dismissal callback, and save callback.
 * @returns The settings dialog body.
 */
function ContainerSettingsForm(
  props: ContainerSettingsFormProps,
): React.JSX.Element {
  const fieldId = useId();
  const headingId = `${fieldId}-heading`;
  const nameId = `${fieldId}-name`;
  const containerIdId = `${fieldId}-id`;
  const containerIdHintId = `${containerIdId}-hint`;
  const focusId = `${fieldId}-focus`;
  const focusHintId = `${focusId}-hint`;
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(props.container.name);
  const [promptContext, setPromptContext] = useState(
    props.container.promptContext ?? '',
  );
  const [submission, setSubmission] = useState<DialogSubmission>({
    status: 'idle',
  });
  const isPending = submission.status === 'pending';

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      return;
    }

    setSubmission({ status: 'pending' });
    try {
      await props.onSave({
        name: trimmedName,
        promptContext: promptContext.trim() || null,
      });
    } catch (error: unknown) {
      setSubmission({
        message: submissionMessage(
          error,
          'Could not save the Learning Space settings.',
        ),
        status: 'error',
      });
    }
  };

  return (
    <LearningDialogFrame
      footer={
        <>
          <Button onClick={props.onClose} variant="secondary">
            Cancel
          </Button>
          <Button disabled={isPending} type="submit" variant="primary">
            {isPending ? 'Saving changes…' : 'Save changes'}
          </Button>
        </>
      }
      heading="Learning Space settings"
      headingId={headingId}
      initialFocusRef={nameRef}
      onClose={props.onClose}
      onSubmit={submit}
    >
      <div className={styles.formField}>
        <label htmlFor={nameId}>Name</label>
        <input
          id={nameId}
          maxLength={255}
          onChange={(event) => setName(event.currentTarget.value)}
          ref={nameRef}
          required
          value={name}
        />
      </div>
      <div className={styles.formField}>
        <label htmlFor={containerIdId}>Space ID</label>
        <input
          aria-describedby={containerIdHintId}
          id={containerIdId}
          readOnly
          value={props.container.id}
        />
        <span className={styles.fieldHint} id={containerIdHintId}>
          Space IDs cannot change after creation. Threads can belong to multiple
          spaces.
        </span>
      </div>
      <div className={styles.formField}>
        <label htmlFor={focusId}>Automatic Learning focus</label>
        <textarea
          aria-describedby={focusHintId}
          id={focusId}
          maxLength={4000}
          onChange={(event) => setPromptContext(event.currentTarget.value)}
          placeholder="Focus on access rules, exceptions, and successful resolutions."
          rows={3}
          value={promptContext}
        />
        <span className={styles.fieldHint} id={focusHintId}>
          Optional. This guides what the analysis looks for across these
          Threads.
        </span>
      </div>
      {submission.status === 'error' ? (
        <p className={styles.dialogError} role="alert">
          {submission.message}
        </p>
      ) : null}
    </LearningDialogFrame>
  );
}

interface AnalyzeThreadsDialogProps {
  readonly onClose: () => void;
  readonly onConfirm: () => Promise<void>;
  readonly open: boolean;
  readonly progress: LearningContainerStats | null;
}

/**
 * Renders the confirmation dialog for analyzing a Container's new Threads.
 *
 * @param props - Dismissal callback, confirm callback, and evidence progress.
 * @returns The analysis confirmation dialog while open, otherwise nothing.
 */
export function AnalyzeThreadsDialog(
  props: AnalyzeThreadsDialogProps,
): React.JSX.Element | null {
  if (!props.open) {
    return null;
  }

  return (
    <AnalyzeThreadsForm
      onClose={props.onClose}
      onConfirm={props.onConfirm}
      progress={props.progress}
    />
  );
}

interface AnalyzeThreadsFormProps {
  readonly onClose: () => void;
  readonly onConfirm: () => Promise<void>;
  readonly progress: LearningContainerStats | null;
}

/**
 * Renders the evidence summary and the limited-evidence warning.
 *
 * @param props - Dismissal callback, confirm callback, and evidence progress.
 * @returns The analysis confirmation body.
 */
function AnalyzeThreadsForm(props: AnalyzeThreadsFormProps): React.JSX.Element {
  const fieldId = useId();
  const headingId = `${fieldId}-heading`;
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [submission, setSubmission] = useState<DialogSubmission>({
    status: 'idle',
  });
  const isPending = submission.status === 'pending';
  const pendingThreadCount = props.progress?.pendingThreadCount ?? null;
  const hasLimitedEvidence =
    pendingThreadCount !== null && pendingThreadCount < readyThreadTarget;
  const pendingThreadWord = pendingThreadCount === 1 ? 'Thread' : 'Threads';

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmission({ status: 'pending' });
    try {
      await props.onConfirm();
    } catch (error: unknown) {
      setSubmission({
        message: submissionMessage(error, 'Could not start the analysis.'),
        status: 'error',
      });
    }
  };

  const confirmLabel = hasLimitedEvidence
    ? 'Analyze anyway'
    : 'Start manual run now';

  return (
    <LearningDialogFrame
      footer={
        <>
          <Button onClick={props.onClose} variant="secondary">
            Cancel
          </Button>
          <Button
            disabled={isPending}
            ref={confirmRef}
            type="submit"
            variant="primary"
          >
            {isPending ? 'Starting analysis…' : confirmLabel}
          </Button>
        </>
      }
      heading="Analyze these Threads?"
      headingId={headingId}
      initialFocusRef={confirmRef}
      onClose={props.onClose}
      onSubmit={submit}
      wide
    >
      <div className={styles.runSummary}>
        <div>
          <strong>{pendingThreadCount?.toLocaleString() ?? '—'}</strong>
          <span>new {pendingThreadWord}</span>
        </div>
        <div>
          <strong>{props.progress?.threadCount.toLocaleString() ?? '—'}</strong>
          <span>in space</span>
        </div>
        <div>
          <strong>{lastAnalysisValue(props.progress)}</strong>
          <span>last analysis</span>
        </div>
      </div>
      {props.progress === null ? (
        <p className={styles.fieldHint}>
          Thread counts are unavailable. The analysis will use any new Threads
          collected by this space.
        </p>
      ) : hasLimitedEvidence ? (
        <div className={styles.runWarning}>
          <WarningGlyph />
          <div className={styles.runWarningCopy}>
            <strong>Limited evidence</strong>
            <span>
              {pendingThreadCount} new {pendingThreadWord} collected. This
              analysis may produce sparse or inconclusive Insights.
            </span>
          </div>
        </div>
      ) : null}
      {submission.status === 'error' ? (
        <p className={styles.dialogError} role="alert">
          {submission.message}
        </p>
      ) : null}
    </LearningDialogFrame>
  );
}
