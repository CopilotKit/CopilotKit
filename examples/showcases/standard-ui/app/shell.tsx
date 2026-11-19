"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { standardUI } from "@copilotkit/react-core/v2/generative-ui";
import pkg from "../package.json";
import { ArrowUpRight, ChatBubble, PanelToggle, Tiles } from "./icons";
import { SIDEBAR_KEY } from "./sidebar-state";

/** Where to start building with generative UI components. */
export const DOCS_URL = "https://docs.copilotkit.ai/generative-ui/components";

/** The standard catalog's docs: one page per component. */
export const CATALOG_DOCS_URL = `${DOCS_URL}/standard-catalog`;

/** Child components are documented on their parent's page. */
const DOCS_PAGE_OF: Record<string, string> = {
  GridItem: "Grid",
  FlowItem: "Flow",
  CarouselItem: "Carousel",
  CarouselMediaItem: "Carousel",
  PopoverTrigger: "Popover",
  PopoverContent: "Popover",
  TableSection: "Table",
  TableRow: "Table",
  TableCell: "Table",
  ListItem: "List",
};

/** The docs page of a standard component: CheckBox is /check-box. */
export function componentDocsUrl(name: string) {
  const page = (DOCS_PAGE_OF[name] ?? name)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
  return `${CATALOG_DOCS_URL}/${page}`;
}

export const COMPONENT_COUNT = Object.keys(
  standardUI.manifestComponents,
).length;

/**
 * The Docs button, pinned to the top right of the canvas (the chat card, the
 * catalog header), so the way to build it yourself is always in view.
 */
export function DocsButton({ className }: { className?: string }) {
  return (
    <a
      href={DOCS_URL}
      target="_blank"
      rel="noreferrer"
      className={`ck-docs ck-focus${className ? ` ${className}` : ""}`}
    >
      Docs
      <ArrowUpRight className="ck-link-icon" />
      <span className="ck-visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * The six soft blur circles behind every page: the CopilotKit backdrop
 * (copilotkit-ui-theme). Fixed, so they never add scroll; decorative only.
 */
export function Backdrop() {
  return (
    <div className="ck-backdrop" aria-hidden="true">
      <span
        style={{
          width: 446,
          height: 446,
          left: 1040,
          top: 11,
          background: "rgba(255, 172, 77, 0.2)",
        }}
      />
      <span
        style={{
          width: 609,
          height: 609,
          left: 1339,
          top: 625,
          background: "#C9C9DA",
        }}
      />
      <span
        style={{
          width: 609,
          height: 609,
          left: 670,
          top: -365,
          background: "#C9C9DA",
        }}
      />
      <span
        style={{
          width: 609,
          height: 609,
          left: 508,
          top: 702,
          background: "#F3F3FC",
        }}
      />
      <span
        style={{
          width: 446,
          height: 446,
          left: 128,
          top: 331,
          background: "rgba(255, 243, 136, 0.3)",
        }}
      />
      <span
        style={{
          width: 446,
          height: 446,
          left: -205,
          top: 803,
          background: "rgba(255, 172, 77, 0.2)",
        }}
      />
    </div>
  );
}

/** A 10px uppercase label with a rule that runs to the edge. */
export function SectionTitle({
  children,
  id,
}: {
  children: ReactNode;
  id?: string;
}) {
  return (
    <div className="ck-section-title">
      <h2 id={id}>{children}</h2>
      <span aria-hidden="true" />
    </div>
  );
}

/** The sidebar's collapsed state, shared by every page through <html data-sidebar>. */
function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  // Read what the pre-paint script applied before writing anything back.
  const ready = useRef(false);
  useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebar === "collapsed");
    ready.current = true;
  }, []);
  const apply = useCallback((next: boolean) => {
    setCollapsed(next);
    if (next) document.documentElement.dataset.sidebar = "collapsed";
    else delete document.documentElement.dataset.sidebar;
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? "collapsed" : "open");
    } catch {
      // Storage unavailable: the choice lasts for this page only.
    }
  }, []);
  const toggle = useCallback(() => {
    if (!ready.current) return;
    apply(document.documentElement.dataset.sidebar !== "collapsed");
  }, [apply]);
  // Cmd/Ctrl+B toggles it from anywhere on the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "b"
      ) {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  return { collapsed, toggle };
}

const SHORTCUT = "\u2318B";

/**
 * The glass sidebar every page shares. A fixed head (logo, collapse toggle,
 * title, page tabs) over a body that scrolls without a visible scrollbar.
 * Collapsed, it is a rail: the kite mark, the toggle and the two pages.
 */
export function Sidebar({
  current,
  children,
}: {
  current: "chat" | "catalog" | null;
  children?: ReactNode;
}) {
  const { collapsed, toggle } = useSidebarCollapsed();
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <aside className="ck-sidebar" aria-label="Sidebar">
      <div className="ck-sidebar-head">
        <Link
          href="/"
          className="ck-logo ck-focus"
          aria-label="CopilotKit standard components"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- the official CopilotKit logotype */}
          <img
            className="ck-logo-full"
            src="/copilotkit-logo.svg"
            alt=""
            width={146}
            height={28}
          />
          {/* eslint-disable-next-line @next/next/no-img-element -- the official CopilotKit mark, for the rail */}
          <img
            className="ck-logo-mark"
            src="/copilotkit-mark.svg"
            alt=""
            width={30}
            height={32}
          />
        </Link>
        <button
          type="button"
          className="ck-collapse ck-focus"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls="ck-sidebar-body"
          aria-label={toggleLabel}
          title={`${toggleLabel} (${SHORTCUT})`}
        >
          <PanelToggle collapsed={collapsed} />
        </button>
        <p className="ck-app-title">Standard components</p>
        <p className="ck-app-sub">
          Generative UI · {COMPONENT_COUNT} components, rendered live
        </p>
        <nav className="ck-tabs ck-page-tabs" aria-label="Pages">
          <Link
            href="/"
            className="ck-tab ck-focus"
            aria-current={current === "chat" ? "page" : undefined}
          >
            Chat
          </Link>
          <Link
            href="/catalog"
            className="ck-tab ck-focus"
            aria-current={current === "catalog" ? "page" : undefined}
          >
            Catalog
          </Link>
        </nav>
      </div>
      <nav className="ck-rail" aria-label="Pages">
        <Link
          href="/"
          className="ck-rail-link ck-focus"
          aria-current={current === "chat" ? "page" : undefined}
          aria-label="Chat"
          title="Chat"
        >
          <ChatBubble />
        </Link>
        <Link
          href="/catalog"
          className="ck-rail-link ck-focus"
          aria-current={current === "catalog" ? "page" : undefined}
          aria-label="Catalog"
          title="Catalog"
        >
          <Tiles />
        </Link>
      </nav>
      <div className="ck-sidebar-scroll" id="ck-sidebar-body">
        <div className="ck-sidebar-body">
          {children}
          <footer className="ck-sidebar-foot">
            <a
              href={CATALOG_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="ck-link ck-focus"
            >
              Standard catalog docs
              <ArrowUpRight className="ck-link-icon" />
              <span className="ck-visually-hidden"> (opens in a new tab)</span>
            </a>
            <p>
              <code>{standardUI.id}</code> from{" "}
              <code>
                @copilotkit/react-core@
                {pkg.dependencies["@copilotkit/react-core"]}
              </code>
              , unmodified.
            </p>
          </footer>
        </div>
      </div>
    </aside>
  );
}
