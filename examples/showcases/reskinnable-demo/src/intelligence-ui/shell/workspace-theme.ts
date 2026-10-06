/* eslint-disable react-hooks/set-state-in-effect -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import { useCallback, useEffect, useState } from 'react';

export type WorkspaceThemePreference = 'light' | 'dark' | 'system';

const storageKey = 'workspace-theme-preference';
const darkQuery = '(prefers-color-scheme: dark)';
const themeChangeEvent = 'cpki-workspace-theme-change';
let inMemoryPreference: WorkspaceThemePreference | null = null;
let storageWriteDenied = false;

/** Read a valid saved preference, defaulting to the live system theme. */
export function readWorkspaceThemePreference(): WorkspaceThemePreference {
  try {
    const saved = window.localStorage.getItem(storageKey);
    return saved === 'light' || saved === 'dark'
      ? saved
      : storageWriteDenied
        ? (inMemoryPreference ?? 'system')
        : 'system';
  } catch {
    return inMemoryPreference ?? 'system';
  }
}

/** Apply one document theme boundary before React paints, including portals. */
export function applyWorkspaceThemePreference(
  preference: WorkspaceThemePreference,
): void {
  document.documentElement.setAttribute('data-cpki-theme', preference);
  document.documentElement.setAttribute('data-cpki-design', 'workspace');
  document.body.removeAttribute('data-cpki-theme');
  document.body.removeAttribute('data-cpki-design');
  document
    .querySelector('cpki-intelligence-root')
    ?.removeAttribute('data-cpki-theme');
}

/** Keep the icon current when the OS theme changes while System is selected. */
export function useWorkspaceTheme(): {
  readonly preference: WorkspaceThemePreference;
  readonly resolvedTheme: 'light' | 'dark';
  readonly setPreference: (value: WorkspaceThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState(
    readWorkspaceThemePreference,
  );
  const [systemDark, setSystemDark] = useState(
    // Demo: Next renders this on the server first, where there is no window.
    () =>
      typeof window !== 'undefined' &&
      (window.matchMedia?.(darkQuery).matches ?? false),
  );

  useEffect(() => {
    applyWorkspaceThemePreference(preference);
  }, [preference]);

  useEffect(() => {
    const onPreferenceChange = (event: Event): void => {
      setPreferenceState(
        (event as CustomEvent<WorkspaceThemePreference>).detail,
      );
    };
    window.addEventListener(themeChangeEvent, onPreferenceChange);
    return () =>
      window.removeEventListener(themeChangeEvent, onPreferenceChange);
  }, []);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const media = window.matchMedia(darkQuery);
    const onChange = (event: MediaQueryListEvent): void => {
      setSystemDark(event.matches);
    };
    setSystemDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const setPreference = useCallback((value: WorkspaceThemePreference): void => {
    inMemoryPreference = value;
    try {
      window.localStorage.setItem(storageKey, value);
      storageWriteDenied = false;
    } catch {
      storageWriteDenied = true;
    }
    applyWorkspaceThemePreference(value);
    setPreferenceState(value);
    window.dispatchEvent(
      new CustomEvent<WorkspaceThemePreference>(themeChangeEvent, {
        detail: value,
      }),
    );
  }, []);

  return {
    preference,
    resolvedTheme:
      preference === 'system' ? (systemDark ? 'dark' : 'light') : preference,
    setPreference,
  };
}

/**
 * Demo addition: drop the workspace boundary from the document root when the
 * /intelligence screens unmount, so another app's page in this Next app keeps
 * its own look after a client-side navigation.
 */
export function clearWorkspaceTheme(): void {
  document.documentElement.removeAttribute('data-cpki-theme');
  document.documentElement.removeAttribute('data-cpki-design');
}
