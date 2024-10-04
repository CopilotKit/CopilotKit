import clsx from 'clsx';

export interface ChipProps {
  className?: string;
  variant?: 'low' | 'medium' | 'high';
  children: string;
}

export function Chip({ className, variant, children }: ChipProps) {
  return (
    <span
      className={clsx(
        'rounded-md bg-white px-3 py-1.5 text-sm shadow-md',
        {
          'text-accent': !variant,
          'text-low': variant === 'low',
          'text-medium': variant === 'medium',
          'text-high': variant === 'high',
        },
        className,
      )}
    >
      {children}
    </span>
  );
}
