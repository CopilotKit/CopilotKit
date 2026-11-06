import { useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { CopyButton } from "../ui/data-display";
import { Input, Textarea } from "../ui/forms";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/layout";
import { Button } from "../ui/primitives";
import type {
  LearningContainer,
  UpdateLearningContainerInput,
} from "./learning-api";
import { SkillDelivery } from "./skill-delivery";
import styles from "./learning-space-settings.module.css";

export interface LearningSpaceSettingsProps {
  /** Optional full-width card below the grid, e.g. agent connection setup. */
  readonly connect?: ReactNode;
  readonly container: LearningContainer;
  readonly onLoadDelivery?: (signal: AbortSignal) => Promise<boolean | null>;
  readonly onSave: (input: UpdateLearningContainerInput) => Promise<void>;
  readonly onSetDelivery: (enabled: boolean) => Promise<void>;
  readonly schedule?: ReactNode;
}

/**
 * Edits a real Learning Space beside its project-owned delivery and schedule
 * controls: General on the left; delivery and schedule cards on the right.
 *
 * @param props - The space, its save action, delivery reads and writes, and the schedule.
 * @returns The Settings tab layout.
 */
export function LearningSpaceSettings(
  props: LearningSpaceSettingsProps,
): React.JSX.Element {
  const id = useId();
  const [name, setName] = useState(props.container.name);
  const [promptContext, setPromptContext] = useState(
    props.container.promptContext ?? "",
  );
  const [savedValues, setSavedValues] = useState({
    name: props.container.name,
    promptContext: props.container.promptContext ?? "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty =
    name.trim() !== savedValues.name ||
    promptContext.trim() !== savedValues.promptContext;

  /** Keeps the form and its error visible until the authoritative write succeeds. */
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || pending) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const nextContext = promptContext.trim();
      await props.onSave({
        name: trimmedName,
        promptContext: nextContext || null,
      });
      setSavedValues({ name: trimmedName, promptContext: nextContext });
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the Learning Space settings.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={styles.layout}>
      <Card className={styles.card}>
        <form className={styles.form} onSubmit={submit}>
          <CardHeader className={styles.cardHead}>
            <CardTitle>
              <h2 className={styles.heading}>General</h2>
            </CardTitle>
            <CardDescription>
              Give this Learning Space a clear name and focus.
            </CardDescription>
          </CardHeader>
          <CardContent className={styles.fields}>
            <div className={styles.field}>
              <label htmlFor={`${id}-name`}>Name</label>
              <Input
                disabled={pending}
                id={`${id}-name`}
                maxLength={255}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaved(false);
                }}
                required
                value={name}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor={`${id}-space-id`}>Space ID</label>
              <Input
                aria-describedby={`${id}-space-id-hint`}
                id={`${id}-space-id`}
                readOnly
                value={props.container.id}
              />
              <p className={styles.hint} id={`${id}-space-id-hint`}>
                Space IDs cannot change after creation. Threads can belong to
                multiple spaces.
              </p>
            </div>
            <div className={styles.field}>
              <label htmlFor={`${id}-focus`}>Automatic Learning focus</label>
              <Textarea
                aria-describedby={`${id}-focus-hint`}
                disabled={pending}
                id={`${id}-focus`}
                maxLength={4000}
                onChange={(event) => {
                  setPromptContext(event.target.value);
                  setSaved(false);
                }}
                placeholder="Focus on access rules, exceptions, and successful resolutions."
                rows={4}
                value={promptContext}
              />
              <p className={styles.hint} id={`${id}-focus-hint`}>
                Optional. This guides what the analysis looks for across these
                Threads.
              </p>
            </div>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
          </CardContent>
          <CardFooter className={styles.cardFoot}>
            <span role="status">
              {saved
                ? "Changes saved."
                : "Changes apply to this Learning Space."}
            </span>
            <Button
              disabled={pending || !dirty || !name.trim()}
              type="submit"
              variant="primary"
            >
              {pending ? "Saving changes…" : "Save changes"}
            </Button>
          </CardFooter>
        </form>
      </Card>
      <div className={styles.side}>
        <SkillDelivery
          containerId={props.container.id}
          details={
            <div className={styles.runtime}>
              <span className={styles.runtimeLabel}>Runtime identifier</span>
              <div className={styles.runtimeValue}>
                <code data-slot="identifier">{props.container.id}</code>
                <CopyButton label="Copy space ID" value={props.container.id} />
              </div>
              <p className={styles.hint}>
                Only published Skills can be sent to your agent.
              </p>
            </div>
          }
          onLoadDelivery={props.onLoadDelivery}
          onSetDelivery={props.onSetDelivery}
          variant="card"
        />
        {props.schedule ? (
          <Card className={styles.card}>
            <CardHeader className={styles.cardHead}>
              <CardTitle>
                <h2 className={styles.heading}>Analysis schedule</h2>
              </CardTitle>
              <CardDescription>
                Applies to all Learning Spaces in this project.
              </CardDescription>
            </CardHeader>
            <CardContent>{props.schedule}</CardContent>
          </Card>
        ) : null}
      </div>
      {props.connect ? (
        <div className={styles.full}>{props.connect}</div>
      ) : null}
    </div>
  );
}
