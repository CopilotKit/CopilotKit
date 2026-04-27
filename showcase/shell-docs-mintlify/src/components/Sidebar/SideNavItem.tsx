import { cn, Icon } from '@mintlify/components';
import type { NavPage } from '@mintlify/astro/helpers';
import type { SidebarItemStyle } from './types';
import { resolveIntegration } from '../../lib/integration';

export interface SideNavItemProps {
  page: NavPage;
  currentPath: string;
  sidebarItemStyle?: SidebarItemStyle;
}

const ACTIVE_TEXT = 'text-(--primary) font-medium';

const sidebarStyles: Record<
  SidebarItemStyle,
  { base?: string; active: string; inactive: string }
> = {
  container: {
    base: 'rounded-xl w-full outline-offset-[-1px]',
    active: `bg-(--primary)/10 ${ACTIVE_TEXT}`,
    inactive:
      'hover:bg-gray-600/5 dark:hover:bg-white/5 text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100',
  },
  card: {
    base: 'ml-4 border-l outline-offset-[-1px]',
    active: `border-(--primary) bg-(--primary)/10 ${ACTIVE_TEXT}`,
    inactive:
      'border-gray-950/5 dark:border-white/10 hover:bg-gray-600/5 dark:hover:bg-white/5 text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100',
  },
  border: {
    base: 'ml-4 border-l py-2 lg:py-1.5 w-[calc(100%-1rem)]',
    active: `border-(--primary) ${ACTIVE_TEXT}`,
    inactive:
      'border-gray-950/5 dark:border-white/10 hover:border-gray-950/20 dark:hover:border-white/30 text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100',
  },
  undecorated: {
    active: `border-(--primary) ${ACTIVE_TEXT}`,
    inactive:
      'border-gray-950/5 dark:border-white/10 hover:border-gray-950/20 dark:hover:border-white/30 text-gray-700 hover:text-gray-950 dark:text-gray-300 dark:hover:text-gray-50',
  },
  arrow: {
    active: `border-(--primary) ${ACTIVE_TEXT}`,
    inactive:
      'border-gray-950/5 dark:border-white/10 hover:border-gray-950/20 dark:hover:border-white/30 text-gray-700 hover:text-gray-950 dark:text-gray-300 dark:hover:text-gray-50',
  },
  plain: {
    active: ACTIVE_TEXT,
    inactive: 'text-gray-950 dark:text-gray-100 hover:text-(--primary)',
  },
};

export function SideNavItem({
  page,
  currentPath,
  sidebarItemStyle = 'container',
}: SideNavItemProps) {
  const isActive = page.href === currentPath;
  const title = page.title;
  const isOneWord = title.split(' ').length === 1;
  const variant = sidebarStyles[sidebarItemStyle];
  const itemIntegration = resolveIntegration(page.href);

  return (
    <li className="relative scroll-m-4 first:scroll-m-20" data-title={title} data-item-integration={itemIntegration}>
      <a
        href={page.href}
        className={cn(
          'group flex items-center pl-4 pr-3 py-1.5 cursor-pointer gap-x-3 text-left',
          isOneWord && 'wrap-break-word hyphens-auto',
          variant.base,
          isActive ? variant.active : variant.inactive,
        )}
        aria-current={isActive ? 'page' : undefined}
      >
        {sidebarItemStyle === 'arrow' && isActive && (
          <Icon
            icon="chevron-right"
            iconLibrary="lucide"
            className="absolute left-0 text-(--primary) group-hover:text-(--primary)"
            size={16}
          />
        )}
        {page.icon && (
          <span
            className={cn(
              'w-5 h-5 p-0.5 inline-flex items-center justify-center rounded',
              isActive
                ? 'bg-(--primary)'
                : 'bg-gray-400 dark:bg-gray-600',
            )}
          >
            <Icon
              icon={page.icon}
              iconLibrary="lucide"
              className={cn(
                isActive
                  ? 'bg-white'
                  : 'bg-gray-600 group-hover:bg-white dark:bg-gray-300 dark:group-hover:bg-white',
              )}
              overrideColor
              size={12}
            />
          </span>
        )}
        <span className="flex-1 truncate min-w-0">{title}</span>
        {page.deprecated && (
          <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            Deprecated
          </span>
        )}
      </a>
    </li>
  );
}
