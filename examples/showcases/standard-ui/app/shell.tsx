"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { standardUI } from "@copilotkit/react-core/v2/generative-ui";
import pkg from "../package.json";
import { ArrowUpRight, PanelToggle } from "./icons";
import { SIDEBAR_KEY } from "./sidebar-state";

export const DOCS_URL =
  "https://docs.copilotkit.ai/generative-ui/components/standard-catalog";

export const COMPONENT_COUNT = Object.keys(
  standardUI.manifestComponents,
).length;

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

/** The glass sidebar every page shares: logo, title, the page tabs, then the page's own sections. */
/** The sidebar's collapsed state, shared by every page through <html data-sidebar>. */
function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebar === "collapsed");
  }, []);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (next) document.documentElement.dataset.sidebar = "collapsed";
    else delete document.documentElement.dataset.sidebar;
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? "collapsed" : "open");
    } catch {
      // Storage unavailable: the choice lasts for this page only.
    }
  };
  return { collapsed, toggle };
}

export function Sidebar({
  current,
  children,
}: {
  current: "chat" | "catalog" | null;
  children?: ReactNode;
}) {
  const { collapsed, toggle } = useSidebarCollapsed();
  return (
    <aside className="ck-sidebar" id="ck-sidebar">
      <button
        type="button"
        className="ck-collapse ck-focus"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls="ck-sidebar-body"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <PanelToggle collapsed={collapsed} />
      </button>
      <div className="ck-sidebar-body" id="ck-sidebar-body">
        <div className="ck-brand">
          <Link href="/" className="ck-logo ck-focus">
            {/* eslint-disable-next-line @next/next/no-img-element -- the official CopilotKit logotype */}
            <img
              src="/copilotkit-logo.svg"
              alt="CopilotKit"
              width={146}
              height={28}
            />
          </Link>
          <p className="ck-app-title">Standard components</p>
          <p className="ck-app-sub">
            Generative UI · {COMPONENT_COUNT} components, rendered live
          </p>
        </div>
        <nav className="ck-tabs" aria-label="Pages">
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
        {children}
        <footer className="ck-sidebar-foot">
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="ck-link ck-focus"
          >
            Standard components docs
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
    </aside>
  );
}
