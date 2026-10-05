"use client";

/**
 * The Intelligence web app's frame: top bar (mark, scope breadcrumb, account)
 * and project sidebar. Markup and class names follow `WorkspaceHeader`,
 * `ManagedServiceShellFrame`, `ProjectSidebar`, `NavGroup` and `SidebarFooter`
 * in Intelligence apps/app-frontend/react-shell/src/app.tsx (e20922ca4); the
 * styles are that app's own `styles.css` (./intelligence-shell.css).
 *
 * Demo changes: the account trigger is static (no session), the nav carries
 * the demo's routes (Trajectories, Evals, Fine-tune and Data export are new screens), and
 * the sidebar footer shows whether the data is live or sample.
 */
import { useEffect } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Badge } from "../ui/feedback";
import { probe, useDataSource } from "../data/client";
import { Link } from "./router";

export const INTELLIGENCE_BASE = "/intelligence";
const PROJECT_LABEL = "Ledgerline";
const ACCOUNT_LABEL = "maya.chen";

interface NavItem {
  readonly icon: string;
  readonly label: string;
  readonly to?: string;
  readonly match?: string;
  readonly badge?: string;
}

const PRIMARY: readonly NavItem[] = [
  {
    icon: "home",
    label: "Overview",
    to: `${INTELLIGENCE_BASE}/overview`,
    match: `${INTELLIGENCE_BASE}/overview`,
  },
  {
    icon: "model_training",
    label: "Automatic Learning",
    to: `${INTELLIGENCE_BASE}/learning`,
    match: `${INTELLIGENCE_BASE}/learning`,
  },
  {
    icon: "fact_check",
    label: "Eval candidates",
    to: `${INTELLIGENCE_BASE}/evals`,
    match: `${INTELLIGENCE_BASE}/evals`,
    badge: "New",
  },
  {
    icon: "neurology",
    label: "Fine-tune",
    to: `${INTELLIGENCE_BASE}/fine-tune`,
    match: `${INTELLIGENCE_BASE}/fine-tune`,
    badge: "New",
  },
  {
    icon: "file_export",
    label: "Data export",
    to: `${INTELLIGENCE_BASE}/export`,
    match: `${INTELLIGENCE_BASE}/export`,
    badge: "New",
  },
  { icon: "lightbulb", label: "Product Insights" },
  { icon: "monitoring", label: "Product Analytics" },
];
const RESOURCES: readonly NavItem[] = [
  {
    icon: "route",
    label: "Trajectories",
    to: `${INTELLIGENCE_BASE}/trajectories`,
    match: `${INTELLIGENCE_BASE}/trajectories`,
    badge: "New",
  },
  { icon: "gesture", label: "Threads" },
  { icon: "psychology", label: "User Memories" },
  { icon: "key_vertical", label: "API Keys" },
];

function NavGroup(props: {
  readonly items: readonly NavItem[];
  readonly label?: string;
}) {
  const pathname = usePathname() ?? "";
  return (
    <div className="cpki-nav-group">
      {props.label ? (
        <p className="shell-nav-group-label">{props.label}</p>
      ) : null}
      {props.items.map((item) => {
        const content = (
          <>
            <span
              aria-hidden="true"
              className="material-symbols-rounded cpki-nav-item__icon"
            >
              {item.icon}
            </span>
            <span className="cpki-nav-item__label">{item.label}</span>
            {item.badge ? (
              <Badge className="cpki-nav-item__badge" variant="neutral">
                {item.badge}
              </Badge>
            ) : null}
          </>
        );
        if (item.to === undefined) {
          return (
            <span
              aria-disabled="true"
              className="cpki-nav-item cpki-nav-item--disabled"
              key={item.label}
            >
              {content}
            </span>
          );
        }
        const active =
          item.match !== undefined &&
          (pathname === item.match ||
            pathname.startsWith(`${item.match}/`) ||
            (item.label === "Overview" && pathname === INTELLIGENCE_BASE));
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={
              active ? "cpki-nav-item cpki-nav-item--active" : "cpki-nav-item"
            }
            key={item.label}
            to={item.to}
          >
            {content}
          </Link>
        );
      })}
    </div>
  );
}

/** Live / Sample indicator, in the slot where the real sidebar shows the app version. */
function SourceFooter() {
  const source = useDataSource();
  useEffect(() => {
    void probe();
    const timer = window.setInterval(() => void probe(), 8000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="shell-sidebar__footer">
      <div
        className="shell-version"
        data-source={source}
        title="Where these screens read their data"
      >
        {source === "live"
          ? "live data · /api/learning/v1"
          : source === "sample"
            ? "sample data"
            : "connecting"}
      </div>
    </div>
  );
}

export function ProjectSidebar() {
  return (
    <nav className="shell-sidebar" aria-label="Primary navigation">
      <NavGroup items={PRIMARY} />
      <NavGroup label="Project resources" items={RESOURCES} />
      <SourceFooter />
    </nav>
  );
}

function WorkspaceHeader(props: {
  readonly section?: { label: string; to: string };
  readonly detail?: string;
}) {
  return (
    <header className="shell-topbar">
      <div className="shell-topbar__brand">
        <Link
          aria-label="Go to Home"
          className="shell-topbar__mark-link"
          to={`${INTELLIGENCE_BASE}/overview`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- the shell's own static mark */}
          <img
            className="shell-topbar__mark"
            src="/intelligence-ui/mark.svg"
            alt="CopilotKit"
          />
        </Link>
        <div className="shell-scope" aria-label="Current workspace">
          <span className="shell-scope__selector shell-scope__selector--static">
            <span className="shell-scope__label">Intelligence</span>
          </span>
          <span className="shell-scope__divider">/</span>
          <Link
            className="shell-scope__selector shell-scope__selector--link"
            to={`${INTELLIGENCE_BASE}/overview`}
          >
            <span className="shell-scope__label">{PROJECT_LABEL}</span>
          </Link>
          {props.section ? (
            <>
              <span className="shell-scope__divider">/</span>
              <Link
                className="shell-scope__selector shell-scope__selector--link"
                to={props.section.to}
              >
                <span className="shell-scope__label">
                  {props.section.label}
                </span>
              </Link>
            </>
          ) : null}
          {props.detail ? (
            <>
              <span className="shell-scope__divider">/</span>
              <span className="shell-scope__selector shell-scope__selector--static">
                <span className="shell-scope__label">{props.detail}</span>
              </span>
            </>
          ) : null}
        </div>
      </div>
      <div className="shell-topbar__actions">
        <span className="account-menu__trigger" aria-label="Account">
          <span className="account-menu__trigger-content">
            <span className="account-menu__avatar" aria-hidden="true">
              <span className="account-menu__avatar-fallback">MC</span>
            </span>
            <span
              aria-hidden="true"
              className="account-menu__trigger-name"
              title={ACCOUNT_LABEL}
            >
              {ACCOUNT_LABEL}
            </span>
          </span>
        </span>
      </div>
    </header>
  );
}

/** `ManagedServiceShellFrame`: header over a sidebar + content surface. */
export function IntelligenceShell(props: {
  readonly children: ReactNode;
  readonly sidebar?: ReactNode;
  readonly section?: { label: string; to: string };
  readonly detail?: string;
}) {
  return (
    <div className="app-shell app-shell--workspace">
      <WorkspaceHeader section={props.section} detail={props.detail} />
      <div className="shell-layout">
        {props.sidebar ?? <ProjectSidebar />}
        <main className="shell-content-surface">{props.children}</main>
      </div>
    </div>
  );
}
