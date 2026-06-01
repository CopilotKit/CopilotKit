import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { Overlay, OverlaySet } from "@/lib/overlay-types";
import {
  ALL_OVERLAYS,
  DEFAULT_OVERLAYS,
  PRESETS,
  LEGACY_REDIRECTS,
  FILTER_TRIGGER_OVERLAYS,
} from "@/lib/overlay-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "dashboard:overlays";
const HASH_PREFIX = "matrix:";
const OPS_PROBE_PREFIX = "ops:probe=";

// ---------------------------------------------------------------------------
// URL hash helpers
// ---------------------------------------------------------------------------

/** Parse the current URL hash into tab + overlay set + optional probe ID. */
function parseHash(): {
  tab: "matrix" | "baseline" | "ops";
  overlays: OverlaySet | null;
  probeId: string | null;
} {
  const raw =
    typeof window !== "undefined" ? window.location.hash.slice(1) : "";
  if (!raw) return { tab: "matrix", overlays: null, probeId: null };

  // #ops:probe=<id> — ops tab with probe detail drilldown
  if (raw.startsWith(OPS_PROBE_PREFIX)) {
    const probeId = decodeURIComponent(raw.slice(OPS_PROBE_PREFIX.length));
    return { tab: "ops", overlays: null, probeId: probeId || null };
  }

  // #baseline — switch to baseline tab
  if (raw === "baseline") {
    return { tab: "baseline", overlays: null, probeId: null };
  }

  // #ops — switch to ops tab
  if (raw === "ops") {
    return { tab: "ops", overlays: null, probeId: null };
  }

  // Legacy redirect check
  if (raw in LEGACY_REDIRECTS) {
    const mapped = LEGACY_REDIRECTS[raw];
    // "status" redirects to ops tab
    if (mapped.length === 0) {
      return { tab: "ops", overlays: null, probeId: null };
    }
    const set = new Set(mapped) as OverlaySet;
    return { tab: "matrix", overlays: set, probeId: null };
  }

  // #matrix or #matrix:links,depth,...
  if (raw === "matrix") {
    return { tab: "matrix", overlays: null, probeId: null };
  }

  if (raw.startsWith(HASH_PREFIX)) {
    const parts = raw.slice(HASH_PREFIX.length).split(",");
    const valid = parts.filter((p): p is Overlay =>
      ALL_OVERLAYS.includes(p as Overlay),
    );
    if (valid.length > 0) {
      return {
        tab: "matrix",
        overlays: new Set(valid) as OverlaySet,
        probeId: null,
      };
    }
    return { tab: "matrix", overlays: null, probeId: null };
  }

  return { tab: "matrix", overlays: null, probeId: null };
}

/**
 * Write the URL hash. When `push` is true, creates a new browser history
 * entry (pushState) so back/forward navigation works. When false, uses
 * replaceState (used for initial mount sync to avoid polluting history).
 */
function writeHash(
  tab: "matrix" | "baseline" | "ops",
  overlays?: OverlaySet,
  probeId?: string | null,
  push = false,
): void {
  if (typeof window === "undefined") return;
  const method = push ? "pushState" : "replaceState";

  if (tab === "baseline") {
    window.history[method](null, "", "#baseline");
    return;
  }
  if (tab === "ops") {
    const hash = probeId
      ? `#${OPS_PROBE_PREFIX}${encodeURIComponent(probeId)}`
      : "#ops";
    window.history[method](null, "", hash);
    return;
  }
  if (overlays && overlays.size > 0) {
    const sorted = [...overlays].sort(
      (a, b) => ALL_OVERLAYS.indexOf(a) - ALL_OVERLAYS.indexOf(b),
    );
    window.history[method](null, "", `#${HASH_PREFIX}${sorted.join(",")}`);
  } else {
    window.history[method](null, "", "#matrix");
  }
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function loadFromStorage(): OverlaySet | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const arr: string[] = JSON.parse(raw);
    const valid = arr.filter((s): s is Overlay =>
      ALL_OVERLAYS.includes(s as Overlay),
    );
    return valid.length > 0 ? (new Set(valid) as OverlaySet) : null;
  } catch {
    return null;
  }
}

function saveToStorage(overlays: OverlaySet): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...overlays]));
  } catch {
    // Silently ignore storage errors (quota, private browsing, etc.)
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseOverlaysReturn {
  overlays: OverlaySet;
  activeTab: "matrix" | "baseline" | "ops";
  toggle: (overlay: Overlay) => void;
  applyPreset: (presetId: string) => void;
  setTab: (tab: "matrix" | "baseline" | "ops") => void;
  activePreset: string | null;
  showFilters: boolean;
  has: (overlay: Overlay) => boolean;
  selectedProbeId: string | null;
  selectProbe: (probeId: string | null) => void;
}

export function useOverlays(): UseOverlaysReturn {
  const initialized = useRef(false);

  const [overlays, setOverlays] = useState<OverlaySet>(
    () => new Set(DEFAULT_OVERLAYS) as OverlaySet,
  );
  const [activeTab, setActiveTabRaw] = useState<"matrix" | "baseline" | "ops">(
    "matrix",
  );
  const [selectedProbeId, setSelectedProbeIdRaw] = useState<string | null>(
    null,
  );

  // Sync from URL hash / localStorage after hydration
  useEffect(() => {
    const { tab, overlays: fromHash, probeId } = parseHash();
    const resolved =
      fromHash ??
      loadFromStorage() ??
      (new Set(DEFAULT_OVERLAYS) as OverlaySet);
    setOverlays(resolved);
    setActiveTabRaw(tab);
    setSelectedProbeIdRaw(probeId);
  }, []);

  // On mount, write hash to reflect actual state (handles legacy redirects
  // and fallback from localStorage where the URL had no hash).
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      writeHash(activeTab, overlays, selectedProbeId, false);
    }
  }, [activeTab, overlays, selectedProbeId]);

  // Listen for browser back/forward navigation
  useEffect(() => {
    function onPopState() {
      const { tab, overlays: fromHash, probeId } = parseHash();
      const resolved =
        fromHash ??
        loadFromStorage() ??
        (new Set(DEFAULT_OVERLAYS) as OverlaySet);
      setOverlays(resolved);
      setActiveTabRaw(tab);
      setSelectedProbeIdRaw(probeId);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Sync hash + localStorage whenever overlays change after initialization.
  const updateOverlays = useCallback((next: OverlaySet) => {
    setOverlays(next);
    writeHash("matrix", next, null, true);
    saveToStorage(next);
  }, []);

  const toggle = useCallback((overlay: Overlay) => {
    setOverlays((prev) => {
      // Minimum-one rule: toggling the last active overlay is a no-op
      if (prev.has(overlay) && prev.size === 1) return prev;

      const next = new Set(prev) as OverlaySet;
      if (next.has(overlay)) {
        next.delete(overlay);
      } else {
        next.add(overlay);
      }
      writeHash("matrix", next, null, true);
      saveToStorage(next);
      return next;
    });
  }, []);

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      const next = new Set(preset.overlays) as OverlaySet;
      updateOverlays(next);
    },
    [updateOverlays],
  );

  const setTab = useCallback(
    (tab: "matrix" | "baseline" | "ops") => {
      setActiveTabRaw(tab);
      setSelectedProbeIdRaw(null);
      writeHash(tab, overlays, null, true);
    },
    [overlays],
  );

  const selectProbe = useCallback((probeId: string | null) => {
    setSelectedProbeIdRaw(probeId);
    writeHash("ops", undefined, probeId, true);
  }, []);

  const activePreset = useMemo(() => {
    for (const preset of PRESETS) {
      if (
        preset.overlays.length === overlays.size &&
        preset.overlays.every((o) => overlays.has(o))
      ) {
        return preset.id;
      }
    }
    return null;
  }, [overlays]);

  const showFilters = useMemo(
    () => FILTER_TRIGGER_OVERLAYS.some((o) => overlays.has(o)),
    [overlays],
  );

  const has = useCallback(
    (overlay: Overlay) => overlays.has(overlay),
    [overlays],
  );

  return {
    overlays,
    activeTab,
    toggle,
    applyPreset,
    setTab,
    activePreset,
    showFilters,
    has,
    selectedProbeId,
    selectProbe,
  };
}
