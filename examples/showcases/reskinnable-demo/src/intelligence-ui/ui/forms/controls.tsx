import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react';

import { classNames } from '../class-names';
import fieldStyles from './field.module.css';
import styles from './controls.module.css';

type InvalidControlProps = {
  readonly invalid?: boolean;
};

export type InputProps = InputHTMLAttributes<HTMLInputElement> &
  InvalidControlProps;

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> &
  InvalidControlProps;

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> &
  InvalidControlProps;

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> &
  InvalidControlProps & {
    readonly label: ReactNode;
    readonly description?: ReactNode;
    readonly error?: ReactNode;
  };

/**
 * Renders a token-aware native text input.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, 'aria-invalid': ariaInvalid, ...props },
  ref,
) {
  const isInvalid = invalid || ariaInvalid === true || ariaInvalid === 'true';

  return (
    <input
      {...props}
      ref={ref}
      aria-invalid={isInvalid ? true : undefined}
      className={classNames(styles.control, styles.input, className)}
      data-invalid={isInvalid ? 'true' : undefined}
    />
  );
});

/**
 * Renders a token-aware native textarea.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { className, invalid, 'aria-invalid': ariaInvalid, ...props },
    ref,
  ) {
    const isInvalid = invalid || ariaInvalid === true || ariaInvalid === 'true';

    return (
      <textarea
        {...props}
        ref={ref}
        aria-invalid={isInvalid ? true : undefined}
        className={classNames(styles.control, styles.textarea, className)}
        data-invalid={isInvalid ? 'true' : undefined}
      />
    );
  },
);

/**
 * Renders a token-aware native select.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    { className, invalid, 'aria-invalid': ariaInvalid, ...props },
    ref,
  ) {
    const isInvalid = invalid || ariaInvalid === true || ariaInvalid === 'true';

    return (
      <select
        {...props}
        ref={ref}
        aria-invalid={isInvalid ? true : undefined}
        className={classNames(styles.control, styles.select, className)}
        data-invalid={isInvalid ? 'true' : undefined}
      />
    );
  },
);

/**
 * Renders a labelled native checkbox with optional help and validation text.
 *
 * @param props Checkbox control props.
 * @returns An accessible checkbox field.
 */
export function Checkbox({
  id,
  label,
  description,
  error,
  invalid = false,
  className,
  'aria-describedby': ariaDescribedBy,
  ...props
}: ChoiceProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-label`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = mergeIds(ariaDescribedBy, descriptionId, errorId);
  const isInvalid = invalid || Boolean(error);

  return (
    <label className={classNames(styles.choice, className)} htmlFor={controlId}>
      <input
        {...props}
        id={controlId}
        type="checkbox"
        aria-describedby={describedBy}
        aria-invalid={isInvalid ? true : undefined}
        aria-labelledby={labelId}
        className={styles.choiceInput}
        data-invalid={isInvalid ? 'true' : undefined}
      />
      <span className={styles.choiceText}>
        <span className={fieldStyles.label} id={labelId}>
          {label}
        </span>
        {description ? (
          <span className={fieldStyles.description} id={descriptionId}>
            {description}
          </span>
        ) : null}
        {error ? (
          <span className={fieldStyles.error} id={errorId}>
            {error}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/**
 * Renders a labelled switch using a native checkbox input and switch role.
 *
 * @param props Switch control props.
 * @returns An accessible switch field.
 */
export function Switch({
  id,
  label,
  description,
  error,
  invalid = false,
  className,
  'aria-describedby': ariaDescribedBy,
  ...props
}: ChoiceProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-label`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = mergeIds(ariaDescribedBy, descriptionId, errorId);
  const isInvalid = invalid || Boolean(error);

  return (
    <label
      className={classNames(styles.choice, styles.switchChoice, className)}
      htmlFor={controlId}
    >
      <span className={styles.switchControl}>
        <input
          {...props}
          id={controlId}
          type="checkbox"
          role="switch"
          aria-describedby={describedBy}
          aria-invalid={isInvalid ? true : undefined}
          aria-labelledby={labelId}
          className={styles.switchInput}
          data-invalid={isInvalid ? 'true' : undefined}
        />
        <span className={styles.switchTrack} aria-hidden="true" />
      </span>
      <span className={styles.choiceText}>
        <span className={fieldStyles.label} id={labelId}>
          {label}
        </span>
        {description ? (
          <span className={fieldStyles.description} id={descriptionId}>
            {description}
          </span>
        ) : null}
        {error ? (
          <span className={fieldStyles.error} id={errorId}>
            {error}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/**
 * Merges aria-describedby IDs without leaving duplicate whitespace.
 *
 * @param values Existing and generated ID values.
 * @returns A normalized IDREF list.
 */
function mergeIds(
  ...values: ReadonlyArray<string | false | null | undefined>
): string | undefined {
  const ids = values.filter((value): value is string => Boolean(value));

  return ids.length > 0 ? ids.join(' ') : undefined;
}
