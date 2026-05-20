import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Overlay } from "@/lib/overlay-types";

// ---------------------------------------------------------------------------
// Mocks — window.location.hash and localStorage
// ---------------------------------------------------------------------------

let hashValue = "";
const storageMap = new Map<string, string>();

beforeEach(() => {
  hashValue = "";
  storageMap.clear();

  // Stub location.hash as a getter/setter so the hook can both read and write.
  vi.stubGlobal("location", {
    ...window.location,
    get hash() {
      return hashValue;
    },
    set hash(v: string) {
      hashValue = v.startsWith("#") ? v : `#${v}`;
    },
  });

  // Stub history.replaceState and pushState so writeHash updates our hashValue variable.
  // Updated: writeHash now uses pushState (push=true) for user interactions
  // and replaceState (push=false) for initial mount sync. Both need stubbing.
  const historyHandler = (
    _data: unknown,
    _title: string,
    url?: string | URL | null,
  ) => {
    if (typeof url === "string") {
      const hashIdx = url.indexOf("#");
      hashValue = hashIdx >= 0 ? url.slice(hashIdx) : "";
    }
  };
  vi.spyOn(window.history, "replaceState").mockImplementation(historyHandler);
  vi.spyOn(window.history, "pushState").mockImplementation(historyHandler);

  // Stub localStorage
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => storageMap.set(key, value),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
    get length() {
      return storageMap.size;
    },
    key: (i: number) => [...storageMap.keys()][i] ?? null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

// Fresh import for each test to avoid stale module-level state.
async function importHook() {
  const mod = await import("../useOverlays");
  return mod.useOverlays;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useOverlays", () => {
  // 1. Default state
  it("defaults to links + health when no hash and no localStorage", async () => {
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    expect(result.current.overlays.has("links")).toBe(true);
    expect(result.current.overlays.has("health")).toBe(true);
    expect(result.current.overlays.size).toBe(2);
    expect(result.current.activeTab).toBe("matrix");
  });

  // 2. Toggle adds/removes overlays
  it("toggle adds an overlay when not present", async () => {
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    act(() => {
      result.current.toggle("depth");
    });

    expect(result.current.overlays.has("depth")).toBe(true);
    expect(result.current.overlays.has("links")).toBe(true);
    expect(result.current.overlays.has("health")).toBe(true);
    expect(result.current.overlays.size).toBe(3);
  });

  it("toggle removes an overlay when present", async () => {
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    // Remove "links" — "health" remains
    act(() => {
      result.current.toggle("links");
    });

    expect(result.current.overlays.has("links")).toBe(false);
    expect(result.current.overlays.has("health")).toBe(true);
    expect(result.current.overlays.size).toBe(1);
  });

  // 3. Minimum-one rule
  it("toggle last overlay is a no-op (minimum-one rule)", async () => {
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    // Start with links + health, remove links so only health remains
    act(() => {
      result.current.toggle("links");
    });
    expect(result.current.overlays.size).toBe(1);
    expect(result.current.overlays.has("health")).toBe(true);

    // Try to remove the last one — should be a no-op
    act(() => {
      result.current.toggle("health");
    });
    expect(result.current.overlays.size).toBe(1);
    expect(result.current.overlays.has("health")).toBe(true);
  });

  // 4. applyPreset replaces the full set
  it("applyPreset replaces the full overlay set", async () => {
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    act(() => {
      result.current.applyPreset("parity-review");
    });

    expect(result.current.overlays.size).toBe(2);
    expect(result.current.overlays.has("depth")).toBe(true);
    expect(result.current.overlays.has("parity")).toBe(true);
    expect(result.current.overlays.has("links")).toBe(false);
  });

  // 5. activePreset matches when set equals a preset exactly
  it("activePreset matches when set equals a preset", async () => {
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    act(() => {
      result.current.applyPreset("catalog");
    });

    expect(result.current.activePreset).toBe("catalog");
  });

  // 6. activePreset is null when set doesn't match
  it("activePreset is null when set does not match any preset", async () => {
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    // Default is links + health — not an exact preset match
    expect(result.current.activePreset).toBeNull();
  });

  // 7. showFilters true when depth or parity active
  it("showFilters is true when depth is active", async () => {
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    act(() => {
      result.current.toggle("depth");
    });

    expect(result.current.showFilters).toBe(true);
  });

  it("showFilters is true when parity is active", async () => {
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    act(() => {
      result.current.toggle("parity");
    });

    expect(result.current.showFilters).toBe(true);
  });

  // 8. showFilters false when only links/health/docs
  it("showFilters is false when only links, health, and docs are active", async () => {
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    // Default is links + health. Add docs.
    act(() => {
      result.current.toggle("docs");
    });

    expect(result.current.overlays.has("links")).toBe(true);
    expect(result.current.overlays.has("health")).toBe(true);
    expect(result.current.overlays.has("docs")).toBe(true);
    expect(result.current.showFilters).toBe(false);
  });

  // 9. Legacy hash "coverage" → links + health
  it('legacy hash "coverage" maps to links + health', async () => {
    hashValue = "#coverage";
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    expect(result.current.overlays.has("links")).toBe(true);
    expect(result.current.overlays.has("health")).toBe(true);
    expect(result.current.overlays.size).toBe(2);
    expect(result.current.activeTab).toBe("matrix");
  });

  // 10. Legacy hash "cells" → depth
  it('legacy hash "cells" maps to depth', async () => {
    hashValue = "#cells";
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    expect(result.current.overlays.has("depth")).toBe(true);
    expect(result.current.overlays.size).toBe(1);
    expect(result.current.activeTab).toBe("matrix");
  });

  // 11. Legacy hash "parity" → depth + parity
  it('legacy hash "parity" maps to depth + parity', async () => {
    hashValue = "#parity";
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    expect(result.current.overlays.has("depth")).toBe(true);
    expect(result.current.overlays.has("parity")).toBe(true);
    expect(result.current.overlays.size).toBe(2);
  });

  // 12. Legacy hash "status" → ops tab
  it('legacy hash "status" sets tab to ops', async () => {
    hashValue = "#status";
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    expect(result.current.activeTab).toBe("ops");
  });

  // 13. Hash #matrix:links,depth parses correctly
  it("hash #matrix:links,depth parses correctly", async () => {
    hashValue = "#matrix:links,depth";
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    expect(result.current.overlays.has("links")).toBe(true);
    expect(result.current.overlays.has("depth")).toBe(true);
    expect(result.current.overlays.size).toBe(2);
    expect(result.current.activeTab).toBe("matrix");
  });

  // 14. Hash #ops sets tab to ops
  it("hash #ops sets tab to ops", async () => {
    hashValue = "#ops";
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    expect(result.current.activeTab).toBe("ops");
  });

  // 15. URL hash updates on toggle
  it("URL hash updates on toggle", async () => {
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    act(() => {
      result.current.toggle("depth");
    });

    // Hash should contain all three overlays in canonical order
    expect(hashValue).toContain("matrix:");
    expect(hashValue).toContain("links");
    expect(hashValue).toContain("depth");
    expect(hashValue).toContain("health");
  });

  // 16. localStorage persists overlay state
  it("localStorage persists overlay state", async () => {
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    act(() => {
      result.current.toggle("docs");
    });

    const stored = storageMap.get("dashboard:overlays");
    expect(stored).toBeDefined();
    const parsed: Overlay[] = JSON.parse(stored!);
    expect(parsed).toContain("links");
    expect(parsed).toContain("health");
    expect(parsed).toContain("docs");
  });

  // Extra: has() helper works
  it("has() returns true for active overlays and false otherwise", async () => {
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    expect(result.current.has("links")).toBe(true);
    expect(result.current.has("health")).toBe(true);
    expect(result.current.has("depth")).toBe(false);
    expect(result.current.has("parity")).toBe(false);
    expect(result.current.has("docs")).toBe(false);
  });

  // Extra: setTab switches between matrix and ops
  it("setTab switches between matrix and ops", async () => {
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    expect(result.current.activeTab).toBe("matrix");

    act(() => {
      result.current.setTab("ops");
    });

    expect(result.current.activeTab).toBe("ops");
    expect(hashValue).toBe("#ops");

    act(() => {
      result.current.setTab("matrix");
    });

    expect(result.current.activeTab).toBe("matrix");
  });

  // Extra: localStorage fallback when no hash present
  it("reads from localStorage when no hash is present", async () => {
    storageMap.set(
      "dashboard:overlays",
      JSON.stringify(["depth", "parity", "docs"]),
    );
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    expect(result.current.overlays.has("depth")).toBe(true);
    expect(result.current.overlays.has("parity")).toBe(true);
    expect(result.current.overlays.has("docs")).toBe(true);
    expect(result.current.overlays.size).toBe(3);
  });

  // Extra: applyPreset with unknown preset is a no-op
  it("applyPreset with unknown preset id is a no-op", async () => {
    const useOverlays = await importHook();
    const { result } = renderHook(() => useOverlays());

    const before = result.current.overlays;
    act(() => {
      result.current.applyPreset("nonexistent");
    });

    expect(result.current.overlays).toBe(before);
  });
});
