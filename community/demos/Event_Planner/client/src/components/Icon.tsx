import clsx from 'clsx';
import sprite from '../assets/icons.svg';
import { IconName } from '../interfaces';

export interface IconProps {
  className?: string;
  name: IconName;
  size?: 'sm' | 'md';
}

export function Icon({ className, size = 'md', name }: IconProps) {
  return (
    <svg
      className={clsx(
        'inline-block fill-current stroke-current',
        {
          'h-6 w-6': size === 'md',
          'h-5 w-6': size === 'sm',
        },
        className,
      )}
    >
      <use href={sprite + '#' + name}></use>
    </svg>
  );
}
