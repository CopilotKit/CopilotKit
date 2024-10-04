import clsx from 'clsx';
import { ComponentPropsWithoutRef } from 'react';
import { IconName } from '../interfaces';
import { Icon } from './Icon';

interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  icon,
  type='button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'flex items-center justify-center border border-accent font-medium transition-colors hover:border-accent-hover active:translate-y-px disabled:border-disabled',
        {
          'bg-accent text-white hover:bg-accent-hover disabled:bg-disabled':
            variant === 'primary',
          'bg-white text-accent hover:text-accent-hover disabled:text-disabled':
            variant === 'secondary',
          'gap-2.5 rounded-sm px-4 py-2 text-xs': size === 'sm',
          'gap-2.5 rounded-md px-6 py-2.5 text-sm': size === 'md',
          'text-md gap-4 rounded-md p-4 shadow-sm': size === 'lg',
        },
        className,
      )}
      type={type}
      {...props}
    >
      {icon && size === 'lg' && <Icon name={icon} />}
      {children && (
        <span className={clsx({ 'hidden md:inline': icon && size === 'lg' })}>
          {children}
        </span>
      )}
    </button>
  );
}
