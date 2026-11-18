/* eslint-disable react-hooks/set-state-in-effect -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Switch } from "../ui/forms";
import { Button } from "../ui/primitives";
import styles from "./skill-delivery.module.css";

/** Pieces of the delivery control a layout places where it needs them. */
export interface SkillDeliveryParts {
  /** The switch, named "Skill delivery". */
  readonly control: ReactNode;
  /** Live, server-confirmed status such as "Delivery enabled.". */
  readonly status: ReactNode;
  /** What the setting controls (or keeps) at its current value. */
  readonly note: ReactNode;
  /** Retry actions for a failed read or update; empty when healthy. */
  readonly recovery: ReactNode;
}

/**
 * Displays only the server-confirmed delivery setting and serializes updates.
 *
 * The caller lays the parts out, so the Skills banner and the Settings card
 * share one stateful control.
 *
 * @param props - Label id, loader, saver, and the layout for the parts.
 * @returns The caller's layout of the delivery parts.
 */
export function SkillDeliveryToggle(props: {
  readonly titleId: string;
  readonly onLoad?: (signal: AbortSignal) => Promise<boolean | null>;
  readonly onSave: (enabled: boolean) => Promise<void>;
  readonly children: (parts: SkillDeliveryParts) => ReactNode;
}): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(Boolean(props.onLoad));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
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
    setError("");
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
        setError("");
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof Error ? cause.message : "Could not change delivery.",
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
    ? "Loading delivery status…"
    : enabled === null
      ? "Delivery status unavailable."
      : pending
        ? enabled
          ? "Pausing delivery…"
          : "Enabling delivery…"
        : enabled
          ? "Delivery enabled."
          : "Delivery paused.";

  const control = (
    <span
      ref={rootRef}
      className={styles.control}
      data-unknown={enabled === null || undefined}
    >
      <Switch
        label={
          <span id={props.titleId} className="cpki-visually-hidden">
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
    </span>
  );
  const recovery =
    (enabled === null && props.onLoad && (!loading || attempt > 0)) || error ? (
      <div className={styles.failure}>
        {enabled === null && props.onLoad && (!loading || attempt > 0) ? (
          <Button
            variant="outline"
            size="sm"
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
          <>
            <p role="alert">{error}</p>
            <Button
              ref={retryRef}
              variant="outline"
              size="sm"
              onClick={save}
              aria-disabled={pending}
            >
              Retry delivery update
            </Button>
          </>
        ) : null}
      </div>
    ) : null;

  return (
    <>
      {props.children({
        control,
        note: (
          <span id={`${id}-note`}>
            {enabled === false
              ? "Agents keep Skills they already loaded."
              : "Controls new requests for published Skills."}
          </span>
        ),
        recovery,
        status: (
          <span id={`${id}-status`} role="status">
            {status}
          </span>
        ),
      })}
    </>
  );
}
