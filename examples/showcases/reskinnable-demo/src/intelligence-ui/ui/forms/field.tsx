import { type ReactNode, useId } from 'react';

import { classNames } from '../class-names';
import styles from './field.module.css';

type FieldControlProps = {
  readonly id: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: true;
  readonly required?: boolean;
};

export type FieldProps = {
  readonly id?: string;
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly className?: string;
  readonly children: (controlProps: FieldControlProps) => ReactNode;
};

/**
 * Renders an accessible form field wrapper and passes labelled control props to its child.
 *
 * @param props Field configuration and render callback.
 * @returns A labelled field with optional help and validation text.
 */
export function Field({
  id,
  label,
  description,
  error,
  required = false,
  className,
  children,
}: FieldProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ');
  const controlProps: FieldControlProps = {
    id: controlId,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': error ? true : undefined,
    required,
  };

  return (
    <div className={classNames(styles.field, className)}>
      <label className={styles.label} htmlFor={controlId}>
        {label}
        {required ? (
          <span className={styles.requiredMark} aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </label>
      {children(controlProps)}
      {description ? (
        <div className={styles.description} id={descriptionId}>
          {description}
        </div>
      ) : null}
      {error ? (
        <div className={styles.error} id={errorId} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
