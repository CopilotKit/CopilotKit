// Only a frontend with docs can be the reader's remembered frontend
// (shell-docs src/proto/frontend.tsx). A pick of a frontend in early access
// (iMessage, WhatsApp, SMS, RCS) opens its landing page and leaves the
// remembered one alone, and a `?frontend=` pin or a stored value naming one
// is ignored, so nothing that follows the reader's stack (the home's links,
// Copy prompt, the search scope) is ever given a frontend with no docs.
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// frontend.tsx imports through shell-docs' `@/` alias and from React; its
// store needs only the browser's storage, location, and history.
vi.mock(
  "@/lib/frontends",
  () => import("../../../shell-docs/src/lib/frontends"),
);
vi.mock("react", () => ({
  createContext: () => ({}),
  useContext: () => null,
  useMemo: <T>(fn: () => T) => fn(),
  useSyncExternalStore: () => undefined,
}));
vi.mock("react/jsx-runtime", () => ({ jsx: () => null, jsxs: () => null }));
vi.mock("react/jsx-dev-runtime", () => ({ jsxDEV: () => null }));

import {
  chooseFrontend,
  readFrontend,
  rememberFrontend,
} from "../../../shell-docs/src/proto/frontend";

const KEY = "cpk-proto-frontend";
const EARLY_ACCESS = ["imessage", "whatsapp", "sms", "rcs"] as const;
const SHELL_DOCS = path.resolve(import.meta.dirname, "../../../shell-docs");

/** A browser at `url`, with an empty localStorage. */
function browser(url = "https://docs.example/") {
  const store = new Map<string, string>();
  const location = new URL(url);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("window", {
    location,
    history: {
      replaceState: (_s: unknown, _t: string, to: URL) => {
        location.href = String(to);
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  return { store, location };
}

beforeEach(() => browser());
afterEach(() => vi.unstubAllGlobals());

describe("the remembered frontend", () => {
  test("a pick of a frontend with docs is remembered", () => {
    expect(chooseFrontend("vue")).toBe(true);
    expect(localStorage.getItem(KEY)).toBe("vue");
    expect(readFrontend()).toBe("vue");
    rememberFrontend("slack");
    expect(readFrontend()).toBe("slack");
  });

  test("a pick of an early-access frontend leaves it alone", () => {
    chooseFrontend("vue");
    for (const id of EARLY_ACCESS) {
      expect(chooseFrontend(id)).toBe(false);
      rememberFrontend(id);
      expect(localStorage.getItem(KEY)).toBe("vue");
      expect(readFrontend()).toBe("vue");
    }
  });

  test("and, with none remembered yet, keeps none", () => {
    chooseFrontend("whatsapp");
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(readFrontend()).toBe("");
  });

  test("a ?frontend= pin naming an early-access frontend is ignored", () => {
    const { location } = browser("https://docs.example/?frontend=whatsapp");
    expect(readFrontend()).toBe("");
    localStorage.setItem(KEY, "angular");
    expect(readFrontend()).toBe("angular");
    // A pick doesn't write the early-access frontend into the pin either.
    chooseFrontend("sms");
    expect(location.searchParams.get("frontend")).toBe("whatsapp");
    chooseFrontend("vue");
    expect(location.searchParams.get("frontend")).toBe("vue");
    expect(readFrontend()).toBe("vue");
  });

  test("a stored early-access frontend, from an earlier build, is ignored", () => {
    for (const id of EARLY_ACCESS) {
      localStorage.setItem(KEY, id);
      expect(readFrontend()).toBe("");
    }
    localStorage.setItem(KEY, "not-a-frontend");
    expect(readFrontend()).toBe("");
  });
});

// The surfaces that follow the reader's docs stack must read the frontend
// only from the store above, which never holds a frontend without docs. If
// one starts taking a frontend from somewhere else (the URL, a pick), it
// could be handed an early-access one again: these fail first.
describe("surfaces meant for docs frontends", () => {
  const source = (file: string) =>
    fs.readFileSync(path.join(SHELL_DOCS, file), "utf8");
  /** Other places a frontend could come from. */
  const OTHER_SOURCES = /usePathname|useSearchParams|scopeFromPath|FRONTENDS/;

  test("Copy prompt takes its frontend from the remembered one", () => {
    const text = source("src/proto/copy-prompt-d.tsx");
    expect(text).toMatch(/const \{ frontend \} = useFrontend\(\);/);
    expect(text).not.toMatch(OTHER_SOURCES);
  });

  test("the search scope takes its frontend from the remembered one", () => {
    const text = source("src/components/search/docs-search-dialog.tsx");
    expect(text).toMatch(/const savedFrontend = useSavedFrontend\(\);/);
    expect(text).toMatch(/stackPrefix\(savedFrontend, savedFramework\)/);
    // Its other scope is the URL's own, which never names an early-access
    // frontend (they are no URL prefix).
    expect(text.match(/stackPrefix\(/g)).toHaveLength(1);
  });

  test("the home's integration event takes its frontend from the remembered one", () => {
    const text = source("src/components/telemetry/homepage.ts");
    expect(text).toMatch(/const \{ frontend \} = useFrontend\(\);/);
  });

  test("and the remembered one is never early access", () => {
    for (const id of EARLY_ACCESS) {
      browser(`https://docs.example/?frontend=${id}`);
      localStorage.setItem(KEY, id);
      chooseFrontend(id);
      rememberFrontend(id);
      expect(readFrontend()).toBe("");
    }
  });
});
