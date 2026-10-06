/* eslint-disable react-hooks/set-state-in-effect -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import { animate } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useLocation } from './router';
import { useMotionPreference } from '../ui';
import { Sheet } from '../ui/overlays';
import { WorkspaceRailCollapsedContext } from './workspace-rail-tooltip';

interface WorkspaceShellFrameProps {
  readonly children: ReactNode;
  readonly header: (controls: {
    readonly hasSidebar: boolean;
    readonly isMobile: boolean;
    readonly navigationTriggerRef: RefObject<HTMLButtonElement | null>;
    readonly onOpenNavigation: () => void;
  }) => ReactNode;
  readonly rail: ((onNavigate: () => void) => ReactNode) | null;
}

/** Owns the responsive inset frame and keeps rail width animation local to the shell. */
export function WorkspaceShellFrame(
  props: WorkspaceShellFrameProps,
): React.JSX.Element {
  const location = useLocation();
  const [isMobile, setIsMobile] = useState(
    // Demo: Next renders this on the server first, where there is no window.
    () =>
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(max-width: 767px)').matches ?? false),
  );
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const reducedMotion = useMotionPreference();
  const shellRef = useRef<HTMLDivElement>(null);
  const navigationTriggerRef = useRef<HTMLButtonElement>(null);
  const railWidthRef = useRef(228);

  useEffect(() => {
    const target = collapsed ? 64 : 228;
    const start = railWidthRef.current;
    if (reducedMotion || isMobile) {
      railWidthRef.current = target;
      shellRef.current?.style.setProperty(
        '--workspace-rail-width',
        `${target}px`,
      );
      return undefined;
    }
    const control = animate(start, target, {
      type: 'spring',
      duration: 0.22,
      bounce: 0.18,
      onUpdate: (value) => {
        railWidthRef.current = value;
        shellRef.current?.style.setProperty(
          '--workspace-rail-width',
          `${value}px`,
        );
      },
    });
    return () => control.stop();
  }, [collapsed, isMobile, reducedMotion]);

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 767px)');
    if (!media) return undefined;
    const onChange = (event: MediaQueryListEvent): void => {
      setIsMobile(event.matches);
      setNavigationOpen(false);
      if (event.matches) setCollapsed(false);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    setNavigationOpen(false);
  }, [location.pathname]);

  const rail = props.rail?.(() => setNavigationOpen(false)) ?? null;

  return (
    <div
      className={`app-shell app-shell--workspace${collapsed ? ' app-shell--collapsed' : ''}${rail === null ? ' app-shell--no-sidebar' : ''}`}
      ref={shellRef}
    >
      {props.header({
        hasSidebar: rail !== null,
        isMobile,
        navigationTriggerRef,
        onOpenNavigation: () => {
          if (isMobile) setNavigationOpen(true);
          else setCollapsed((value) => !value);
        },
      })}
      <div
        className={`shell-layout${rail === null ? ' shell-layout--organization' : ''}`}
      >
        {isMobile ? (
          rail ? (
            <Sheet
              open={navigationOpen}
              onOpenChange={setNavigationOpen}
              returnFocusRef={navigationTriggerRef}
              title="Navigation"
            >
              {rail}
            </Sheet>
          ) : null
        ) : (
          <WorkspaceRailCollapsedContext.Provider value={collapsed}>
            {rail}
          </WorkspaceRailCollapsedContext.Provider>
        )}
        <main className="shell-content-surface">{props.children}</main>
      </div>
    </div>
  );
}
