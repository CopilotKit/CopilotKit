"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ConsentCategories = {
  analytics: boolean;
  marketing: boolean;
};

export type ConsentState = {
  decided: boolean;
  categories: ConsentCategories;
  timestamp: number | null;
  version: number;
};

export type Region = "eu" | "us-ca" | "other";

const COOKIE_NAME = "cpk_docs_consent";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const CONSENT_VERSION = 1;
const OPEN_PREFERENCES_EVENT = "cpk:open-cookie-preferences";

const ALL_DENIED: ConsentCategories = { analytics: false, marketing: false };
const ALL_GRANTED: ConsentCategories = { analytics: true, marketing: true };

type ConsentContextValue = {
  state: ConsentState;
  region: Region;
  isStrictRegion: boolean;
  hydrated: boolean;
  preferencesOpen: boolean;
  bannerVisible: boolean;
  acceptAll: () => void;
  rejectAll: () => void;
  savePreferences: (next: ConsentCategories) => void;
  openPreferences: () => void;
  closePreferences: () => void;
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function readCookie(): ConsentState | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  try {
    const parsed = JSON.parse(
      decodeURIComponent(match.split("=")[1]),
    ) as Partial<ConsentState>;
    if (parsed.version !== CONSENT_VERSION) return null;
    return {
      decided: !!parsed.decided,
      categories: {
        analytics: !!parsed.categories?.analytics,
        marketing: !!parsed.categories?.marketing,
      },
      timestamp: parsed.timestamp ?? null,
      version: CONSENT_VERSION,
    };
  } catch {
    return null;
  }
}

export function writeCookie(state: ConsentState) {
  if (typeof document === "undefined") return;
  const value = encodeURIComponent(JSON.stringify(state));
  document.cookie = `${COOKIE_NAME}=${value}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax`;
}

export function defaultState(region: Region): ConsentState {
  // Strict regions (EU/UK/EEA, California): nothing granted by default — wait for consent.
  // Other regions: granted by default; user can opt out.
  const initial = region === "eu" || region === "us-ca" ? ALL_DENIED : ALL_GRANTED;
  return {
    decided: false,
    categories: initial,
    timestamp: null,
    version: CONSENT_VERSION,
  };
}

export function ConsentProvider({
  region,
  children,
}: {
  region: Region;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<ConsentState>(() => defaultState(region));
  const [hydrated, setHydrated] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  useEffect(() => {
    const stored = readCookie();
    if (stored) setState(stored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    const handler = () => setPreferencesOpen(true);
    window.addEventListener(OPEN_PREFERENCES_EVENT, handler);
    return () => window.removeEventListener(OPEN_PREFERENCES_EVENT, handler);
  }, []);

  const persist = useCallback((next: ConsentState) => {
    setState(next);
    writeCookie(next);
  }, []);

  const acceptAll = useCallback(() => {
    persist({
      decided: true,
      categories: ALL_GRANTED,
      timestamp: Date.now(),
      version: CONSENT_VERSION,
    });
    setPreferencesOpen(false);
  }, [persist]);

  const rejectAll = useCallback(() => {
    persist({
      decided: true,
      categories: ALL_DENIED,
      timestamp: Date.now(),
      version: CONSENT_VERSION,
    });
    setPreferencesOpen(false);
  }, [persist]);

  const savePreferences = useCallback(
    (next: ConsentCategories) => {
      persist({
        decided: true,
        categories: { ...next },
        timestamp: Date.now(),
        version: CONSENT_VERSION,
      });
      setPreferencesOpen(false);
    },
    [persist],
  );

  const openPreferences = useCallback(() => setPreferencesOpen(true), []);
  const closePreferences = useCallback(() => setPreferencesOpen(false), []);

  const value = useMemo<ConsentContextValue>(
    () => ({
      state,
      region,
      isStrictRegion: region === "eu" || region === "us-ca",
      hydrated,
      preferencesOpen,
      bannerVisible: hydrated && !state.decided,
      acceptAll,
      rejectAll,
      savePreferences,
      openPreferences,
      closePreferences,
    }),
    [
      state,
      region,
      hydrated,
      preferencesOpen,
      acceptAll,
      rejectAll,
      savePreferences,
      openPreferences,
      closePreferences,
    ],
  );

  return (
    <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>
  );
}

export function useConsent() {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error("useConsent must be used within ConsentProvider");
  return ctx;
}

export function dispatchOpenCookiePreferences() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_PREFERENCES_EVENT));
}
