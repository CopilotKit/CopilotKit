"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Admin, MyelinState } from "./types";

/**
 * The ONE ledger every Myelin surface reads: pages, tools, the journey graph,
 * the chat cards and the presence strip.
 *
 * It POLLS. That is the collaboration mechanism, stated plainly: the store is a
 * single server-side ledger shared by every browser window and by the ADK agent
 * (which writes over REST from another process), so re-reading it on a short
 * interval is what makes the other admin's edits — and the agent's — appear in
 * this window without a reload. A production build would push over a socket;
 * the demo claim ("everyone is editing one journey") is the same either way.
 *
 * WHO IS SIGNED IN comes from `?as=<first name>` on the first load (so the
 * presenter can open a second window as Marcus) and is then held in
 * sessionStorage, so in-app navigation keeps it per window.
 */

const POLL_MS = 3000;
const HEARTBEAT_MS = 4000;
const ADMIN_KEY = "myelin-admin";

const EMPTY: MyelinState = {
  journeys: [],
  groups: [],
  learners: [],
  admins: [],
  presence: [],
  activity: [],
  notifications: [],
  reminders: [],
  version: 0,
};

const FALLBACK_ADMIN: Admin = {
  id: "adm-priya",
  name: "Priya Raman",
  initials: "PR",
  title: "L&D Program Manager",
  color: "#7c3aed",
};

interface LedgerValue {
  data: MyelinState;
  loaded: boolean;
  refresh: () => Promise<boolean>;
  admin: Admin;
  setAdminId: (id: string) => void;
  /** Tell the ledger which page/journey this window is on, for presence. */
  setLocation: (page: string, journeyId: string | null) => void;
}

const LedgerContext = createContext<LedgerValue | null>(null);

function initialAdminId(): string {
  if (typeof window === "undefined") return FALLBACK_ADMIN.id;
  try {
    const as = new URLSearchParams(window.location.search)
      .get("as")
      ?.toLowerCase();
    if (as) {
      const id = as.startsWith("adm-") ? as : `adm-${as}`;
      window.sessionStorage.setItem(ADMIN_KEY, id);
      return id;
    }
    return window.sessionStorage.getItem(ADMIN_KEY) ?? FALLBACK_ADMIN.id;
  } catch {
    return FALLBACK_ADMIN.id;
  }
}

export function MyelinLedgerProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<MyelinState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [adminId, setAdminIdState] = useState<string>(FALLBACK_ADMIN.id);
  const live = useRef(true);
  const lastJson = useRef("");
  const location = useRef<{ page: string; journeyId: string | null }>({
    page: "journeys",
    journeyId: null,
  });

  useEffect(() => {
    // Read `?as=` after mount so server and first client render agree.
    const id = initialAdminId();
    if (id !== FALLBACK_ADMIN.id) queueMicrotask(() => setAdminIdState(id));
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/myelin/v1/ledger", { cache: "no-store" });
      if (!res.ok) throw new Error(`ledger fetch failed: ${res.status}`);
      const text = await res.text();
      if (!live.current) return false;
      if (text !== lastJson.current) {
        lastJson.current = text;
        setData(JSON.parse(text) as MyelinState);
      }
      setLoaded(true);
      return true;
    } catch (error) {
      console.error("[myelin] ledger refresh failed", error);
      if (live.current) setLoaded(true);
      return false;
    }
  }, []);

  // Live updates arrive over ONE server-sent-events stream (see
  // `api/myelin/v1/ledger/stream`). A plain poll is kept only as the fallback
  // for when the stream drops, since EventSource reconnects on its own anyway.
  useEffect(() => {
    live.current = true;
    const apply = (text: string) => {
      if (!live.current || text === lastJson.current) return;
      lastJson.current = text;
      setData(JSON.parse(text) as MyelinState);
      setLoaded(true);
    };
    let fallback: ReturnType<typeof setInterval> | undefined;
    const source = new EventSource("/api/myelin/v1/ledger/stream");
    source.onmessage = (event) => apply(event.data as string);
    source.onopen = () => {
      if (fallback) clearInterval(fallback);
      fallback = undefined;
    };
    source.onerror = () => {
      fallback ??= setInterval(() => void refresh(), POLL_MS);
    };
    const first = setTimeout(() => void refresh(), 0);
    return () => {
      live.current = false;
      source.close();
      clearTimeout(first);
      if (fallback) clearInterval(fallback);
    };
  }, [refresh]);

  const beat = useCallback(() => {
    void fetch("/api/myelin/v1/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ adminId, ...location.current }),
    }).catch(() => {});
  }, [adminId]);

  useEffect(() => {
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [beat]);

  const setLocation = useCallback(
    (page: string, journeyId: string | null) => {
      const prev = location.current;
      location.current = { page, journeyId };
      if (prev.page !== page || prev.journeyId !== journeyId) beat();
    },
    [beat],
  );

  const setAdminId = useCallback((id: string) => {
    try {
      window.sessionStorage.setItem(ADMIN_KEY, id);
    } catch {
      // private window — the choice just will not survive a reload
    }
    setAdminIdState(id);
  }, []);

  const admin = data.admins.find((a) => a.id === adminId) ?? FALLBACK_ADMIN;

  const value = useMemo<LedgerValue>(
    () => ({ data, loaded, refresh, admin, setAdminId, setLocation }),
    [data, loaded, refresh, admin, setAdminId, setLocation],
  );

  return (
    <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>
  );
}

export function useMyelinLedger(): LedgerValue {
  const value = useContext(LedgerContext);
  if (!value)
    throw new Error("useMyelinLedger must be used inside MyelinLedgerProvider");
  return value;
}

/** Write through the REST API as the signed-in admin, then re-read the ledger. */
export function useMyelinWrite() {
  const { admin, refresh } = useMyelinLedger();
  return useCallback(
    async (path: string, init: { method?: string; body?: unknown } = {}) => {
      const res = await fetch(`/api/myelin/v1${path}`, {
        method: init.method ?? "POST",
        headers: {
          "content-type": "application/json",
          "x-myelin-actor": admin.id,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const body = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      await refresh();
      return { ok: res.ok, status: res.status, body };
    },
    [admin.id, refresh],
  );
}
