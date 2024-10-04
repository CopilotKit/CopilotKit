import clsx from 'clsx';
import { ComponentPropsWithoutRef, forwardRef } from 'react';
import { IconButton } from './IconButton';

interface TextareaProps extends ComponentPropsWithoutRef<'textarea'> {
  label: string;
  error?: string;
  onClear?: () => void;
}

export const Textarea = forwardRef(function Textarea(
  props: TextareaProps,
  ref: React.ForwardedRef<HTMLTextAreaElement>,
) {
  const {
    className,
    label,
    error,
    placeholder = 'Input',
    disabled,
    onClear,
    ...otherProps
  } = props;
  return (
    <label className={clsx('flex flex-col gap-1 text-black', className)}>
      <span
        className={clsx(
          'mb-1 leading-none transition-colors text-black',
          disabled ? 'text-disabled' : 'text-accent',
        )}
      >
        {label}
      </span>
      <span className="relative grow">
        <textarea
          className={clsx(
            'peer h-full w-full resize-none rounded-md border bg-transparent py-4 pl-3 pr-10 outline-none transition-colors placeholder:text-current disabled:placeholder:text-disabled text-black',
            error ? 'border-error' : 'border-divider focus:border-accent ',
          )}
          ref={ref}
          placeholder={placeholder}
          disabled={disabled}
          {...otherProps}
        ></textarea>
        <IconButton
          className={clsx(
            'absolute right-3 top-3 text-black',
            error ? 'text-error' : 'text-accent',
          )}
          icon="cross"
          disabled={disabled}
          onClick={onClear}
        />
        {error && (
          <span className="absolute -bottom-1 right-0 translate-y-full text-xs text-error">
            {error}
          </span>
        )}
      </span>
    </label>
  );
});
