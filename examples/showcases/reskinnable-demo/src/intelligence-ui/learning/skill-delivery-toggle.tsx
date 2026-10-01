/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Switch } from '../ui/forms';
import { Button } from '../ui/primitives';
import styles from './skill-delivery.module.css';

/** Displays only the server-confirmed delivery setting and serializes updates. */
export function SkillDeliveryToggle(props: {
  readonly titleId: string;
  readonly onLoad?: (signal: AbortSignal) => Promise<boolean | null>;
  readonly onSave: (enabled: boolean) => Promise<void>;
}): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(Boolean(props.onLoad));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useLayoutEffect(() => {
    if (restoreFocus.current && enabled !== null && !loading && !pending) {
      restoreFocus.current = false;
      rootRef.current
        ?.querySelector<HTMLInputElement>('input[role="switch"]')
        ?.focus();
    }
  }, [enabled, loading, pending]);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    saving.current = false;
    setEnabled(null);
    setPending(false);
    setError('');
    setLoading(Boolean(props.onLoad));
    props.onLoad?.(controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        restoreFocus.current =
          value !== null && document.activeElement === retryRef.current;
        setEnabled(value);
        setLoading(false);
      },
      () => {
        if (!controller.signal.aborted) setLoading(false);
      },
    );
    return () => controller.abort();
  }, [props.onLoad, attempt]);

  /** Retains the last confirmed value until the PATCH succeeds. */
  async function save(): Promise<void> {
    const controller = request.current;
    if (enabled === null || loading || saving.current || !controller) return;
    const next = !enabled;
    saving.current = true;
    setPending(true);
    try {
      await props.onSave(next);
      if (!controller.signal.aborted) {
        restoreFocus.current = document.activeElement === retryRef.current;
        setEnabled(next);
        setError('');
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof Error ? cause.message : 'Could not change delivery.',
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        saving.current = false;
        setPending(false);
      }
    }
  }

  const status = loading
    ? 'Loading delivery status…'
    : enabled === null
      ? 'Delivery status unavailable.'
      : pending
        ? enabled
          ? 'Pausing delivery…'
          : 'Enabling delivery…'
        : enabled
          ? 'Delivery enabled.'
          : 'Delivery paused.';

  return (
    <div
      ref={rootRef}
      className={styles.toggle}
      data-unknown={enabled === null || undefined}
    >
      <Switch
        label={
          <span
            id={props.titleId}
            role="heading"
            aria-level={3}
            className={styles.title}
          >
            Skill delivery
          </span>
        }
        checked={enabled === true}
        disabled={enabled === null || loading}
        aria-disabled={pending || undefined}
        onChange={save}
        aria-describedby={`${id}-status ${id}-note`}
        aria-busy={loading || pending}
        aria-hidden={enabled === null || undefined}
      />
      <span id={`${id}-status`} role="status" className={styles.status}>
        {status}
      </span>
      <span id={`${id}-note`} className={styles.footnote}>
        {enabled === false
          ? 'Agents keep Skills they already loaded.'
          : 'Controls new requests for published Skills.'}
      </span>
      {enabled === null && props.onLoad && (!loading || attempt > 0) ? (
        <Button
          variant="ghost"
          ref={retryRef}
          aria-disabled={loading}
          onClick={() => {
            if (!loading) setAttempt((value) => value + 1);
          }}
        >
          Retry delivery status
        </Button>
      ) : null}
      {error ? (
        <div className={styles.failure}>
          <p role="alert">{error}</p>
          <Button
            ref={retryRef}
            variant="ghost"
            onClick={save}
            aria-disabled={pending}
          >
            Retry delivery update
          </Button>
        </div>
      ) : null}
    </div>
  );
}
