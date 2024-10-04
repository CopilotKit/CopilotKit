import clsx from 'clsx';
import { ComponentPropsWithoutRef } from 'react';
import { Icon, IconProps } from './Icon';

interface IconButtonProps extends ComponentPropsWithoutRef<'button'> {
  icon: IconProps['name'];
  size?: IconProps['size'];
}

export function IconButton({
  className,
  icon,
  size,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      className={clsx(
        'rounded rounded-full p-1 active:scale-95 disabled:text-disabled',
        className,
      )}
      type={type}
      {...props}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
