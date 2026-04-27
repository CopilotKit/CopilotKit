import { useEffect, useRef } from 'react';
import type { NavNode } from '@mintlify/astro/helpers';
import { unwrapNav } from '@mintlify/astro/helpers';
import { type SidebarItemStyle, type AnchorItem } from './types';
import { SidebarEntries } from './SidebarEntries';
import { Anchors } from './Anchors';
import { IntegrationPill } from '../IntegrationPill';

interface SidebarProps {
  navigation: NavNode;
  currentPath: string;
  anchors?: AnchorItem[];
  sidebarItemStyle?: SidebarItemStyle;
  showDivider?: boolean;
}

const SIDEBAR_SCROLL_KEY = 'docs-sidebar-scroll';

export default function Sidebar({
  navigation,
  currentPath,
  anchors = [],
  sidebarItemStyle = 'container',
  showDivider = false,
}: SidebarProps) {
  const entries = unwrapNav(navigation, currentPath);
  const navRef = useRef<HTMLElement | null>(null);

  // Astro view transitions remount the sidebar on every navigation, which
  // resets internal scroll position to 0. We persist it to sessionStorage and
  // restore on mount. We capture the scroll only while the element is still
  // attached — once Astro swaps the DOM, scrollTop on the detached node
  // reads as 0, so we MUST NOT call save() during cleanup or it'll clobber
  // the real value the scroll listener already stored.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const stored = sessionStorage.getItem(SIDEBAR_SCROLL_KEY);
    if (stored) {
      const top = Number(stored);
      if (Number.isFinite(top) && top > 0) {
        nav.scrollTop = top;
      }
    }

    const save = () => {
      // Skip writes when the nav is detached (Astro mid-swap) — scrollTop
      // reads as 0 in that case and would clobber the real value.
      if (!nav.isConnected) return;
      sessionStorage.setItem(SIDEBAR_SCROLL_KEY, String(nav.scrollTop));
    };

    nav.addEventListener('scroll', save, { passive: true });
    document.addEventListener('astro:before-swap', save);
    window.addEventListener('beforeunload', save);

    return () => {
      nav.removeEventListener('scroll', save);
      document.removeEventListener('astro:before-swap', save);
      window.removeEventListener('beforeunload', save);
    };
  }, []);

  return (
    <div className="hidden lg:flex flex-col sticky top-16 h-[calc(100vh-4rem)] w-[18rem] shrink-0 bg-white dark:bg-zinc-950 isolate">
      <nav
        ref={navRef}
        className="relative lg:text-sm lg:leading-6 flex-1 overflow-y-auto pr-8 pb-10"
      >
        <div className="sticky top-0 h-8 z-5 bg-linear-to-b from-white dark:from-zinc-950" />

        <div className="pr-4 mb-4">
          <IntegrationPill currentPath={currentPath} />
        </div>

        {anchors.length > 0 && <Anchors anchors={anchors} />}

        <SidebarEntries
          entries={entries}
          currentPath={currentPath}
          sidebarItemStyle={sidebarItemStyle}
          showDivider={showDivider}
        />
      </nav>
    </div>
  );
}
