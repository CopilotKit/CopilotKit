import clsx from 'clsx';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';

interface BackLinkProps {
  className?: string;
}

export function BackLink({ className }: BackLinkProps) {
  return (
    <Link
      to="/"
      className={clsx(
        'mb-6 flex items-center gap-2 text-sm text-accent xl:mb-5 text-black',
        className,
      )}
    >
      <Icon name="arrow-up" className="-rotate-90" />
      <span>Back</span>
    </Link>
  );
}
