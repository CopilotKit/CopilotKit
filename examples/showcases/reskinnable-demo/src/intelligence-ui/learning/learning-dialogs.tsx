import { ApiClientError } from '../api-client';
import { useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode, RefObject } from 'react';
import { Dialog } from '../ui/overlays';
import { Input, Textarea } from '../ui/forms';
import { Button } from '../ui/primitives';
import { TriangleAlert } from 'lucide-react';

import type {
  CreateLearningContainerInput,
  LearningContainerStats,
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

/** Copy for app-api's refusal to start a run on a local stack with no model. */
export const LEARNING_MODEL_NOT_CONFIGURED_MESSAGE =
  'No Learning model is configured for this installation. Run `copilotkit local setup` to add one.';

/**
 * Reads a failed analysis start as reader-facing copy.
 *
 * @param error - Rejection value from starting the run.
 * @returns The setup instruction for a missing model, otherwise the error's own copy.
 */
function analysisStartMessage(error: unknown): string {
  return error instanceof ApiClientError &&
    error.code === 'LEARNING_MODEL_NOT_CONFIGURED'
    ? LEARNING_MODEL_NOT_CONFIGURED_MESSAGE
    : submissionMessage(error, 'Could not start the analysis.');
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

interface LearningDialogFrameProps {
  readonly children: ReactNode;
  /** Footer actions; the submit button joins the form through `formId`. */
  readonly footer: (formId: string) => ReactNode;
  readonly heading: string;
  readonly headingId: string;
  /** Control that receives focus as soon as the dialog appears. */
  readonly initialFocusRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Stable trigger to focus after a menu launches the dialog. */
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  /** Widens the card for the three-cell analysis summary. */
  readonly wide?: boolean;
}

/**
 * Renders the shared modal chrome for the Learning dialogs.
 *
 * Radix owns focus containment, Escape, and background isolation. The form
 * retains the existing submit, validation, and return-focus behavior.
 *
 * @param props - Heading, body, footer, and dismissal callbacks.
 * @returns The dialog chrome wrapped around a form.
 */
function LearningDialogFrame(
  props: LearningDialogFrameProps,
): React.JSX.Element {
  const formId = useId();
  return (
    <Dialog
      open
      title={props.heading}
      closeLabel="Close"
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      footer={props.footer(formId)}
      initialFocusRef={props.initialFocusRef}
      returnFocusRef={props.returnFocusRef}
      size={props.wide ? 'lg' : 'md'}
    >
      <form className={styles.dialogForm} id={formId} onSubmit={props.onSubmit}>
        {props.children}
      </form>
    </Dialog>
  );
}

interface CreateContainerDialogProps {
  readonly onClose: () => void;
  readonly onCreate: (input: CreateLearningContainerInput) => Promise<void>;
  readonly open: boolean;
  /** Container ids already in use, refused before the request is sent. */
  readonly reservedIds?: readonly string[];
  /** Stable trigger to focus after a menu launches the dialog. */
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
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
      returnFocusRef={props.returnFocusRef}
    />
  );
}

interface CreateContainerFormProps {
  readonly onClose: () => void;
  readonly onCreate: (input: CreateLearningContainerInput) => Promise<void>;
  readonly reservedIds: readonly string[];
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
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
      footer={(formId) => (
        <>
          <Button onClick={props.onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={isPending}
            form={formId}
            type="submit"
            variant="primary"
          >
            {isPending ? 'Creating space…' : 'Create space'}
          </Button>
        </>
      )}
      heading="New Learning Space"
      headingId={headingId}
      initialFocusRef={nameRef}
      onClose={props.onClose}
      onSubmit={submit}
      returnFocusRef={props.returnFocusRef}
    >
      <div className={styles.formField}>
        <label htmlFor={nameId}>Name</label>
        <Input
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
        <Input
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
        <Textarea
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
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
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
      returnFocusRef={props.returnFocusRef}
    />
  );
}

interface AnalyzeThreadsFormProps {
  readonly onClose: () => void;
  readonly onConfirm: () => Promise<void>;
  readonly progress: LearningContainerStats | null;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
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
        message: analysisStartMessage(error),
        status: 'error',
      });
    }
  };

  const confirmLabel = hasLimitedEvidence
    ? 'Analyze anyway'
    : 'Start manual run now';

  return (
    <LearningDialogFrame
      footer={(formId) => (
        <>
          <Button onClick={props.onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={isPending}
            form={formId}
            ref={confirmRef}
            type="submit"
            variant="primary"
          >
            {isPending ? 'Starting analysis…' : confirmLabel}
          </Button>
        </>
      )}
      heading="Analyze these Threads?"
      headingId={headingId}
      initialFocusRef={confirmRef}
      onClose={props.onClose}
      onSubmit={submit}
      returnFocusRef={props.returnFocusRef}
      wide
    >
      <dl className={styles.runSummary}>
        <div>
          <dt>New {pendingThreadWord}</dt>
          <dd>{pendingThreadCount?.toLocaleString() ?? '—'}</dd>
        </div>
        <div>
          <dt>Threads in space</dt>
          <dd>{props.progress?.threadCount.toLocaleString() ?? '—'}</dd>
        </div>
        <div>
          <dt>Last analysis</dt>
          <dd>{lastAnalysisValue(props.progress)}</dd>
        </div>
      </dl>
      {props.progress === null ? (
        <p className={styles.fieldHint}>
          Thread counts are unavailable. The analysis will use any new Threads
          collected by this space.
        </p>
      ) : hasLimitedEvidence ? (
        <div className={styles.runWarning}>
          <TriangleAlert aria-hidden="true" />
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
