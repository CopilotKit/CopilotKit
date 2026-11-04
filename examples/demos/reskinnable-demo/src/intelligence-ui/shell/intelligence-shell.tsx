"use client";
/* eslint-disable react-hooks/refs -- the picker portals into its own wrapper by ref, as Intelligence's WorkspaceProjectPicker does; that app's lint config does not enable the React Compiler rules. */

/**
 * The Intelligence web app's workspace frame: inset rail (logo, project picker,
 * navigation, resources, account menu) beside a topbar (rail toggle, scope
 * breadcrumb, engineering help, theme menu) over the content surface. Markup and
 * class names follow `WorkspaceShellFrame`, `WorkspaceRail`, `WorkspaceHeader`,
 * `NavGroup`, `WorkspaceSidebar`, `WorkspaceProjectPicker` and
 * `SessionAccountButton` in Intelligence apps/app-frontend/react-shell/src
 * (main @ b71006350); the styles are that app's own `styles.css` and
 * `workspace-shell.css`.
 *
 * Demo changes: one project (Ledgerline), so the picker opens a static list; the
 * account menu has no session behind it; the nav carries the demo's routes
 * (Eval candidates, Fine-tune and Data export are new screens); and the
 * version slot says whether the data is live or sample.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Brain,
  Building2,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  ChevronsUpDown,
  ClipboardCheck,
  FileOutput,
  FolderOpen,
  Github,
  GraduationCap,
  House,
  KeyRound,
  LayoutGrid,
  Lightbulb,
  LogOut,
  MessagesSquare,
  PanelLeft,
  Route as RouteIcon,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "../ui/feedback";
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "../ui/overlays";
import { LinkButton } from "../ui/primitives";
import { probe, useDataSource } from "../data/client";
import { Link, useLocation } from "./router";
import { WorkspaceShellFrame } from "./workspace-shell-frame";
import {
  WorkspaceRailTooltip,
  useWorkspaceRailCollapsed,
} from "./workspace-rail-tooltip";
import { WorkspaceThemeMenu } from "./workspace-theme-menu";
import { clearWorkspaceTheme } from "./workspace-theme";

export const INTELLIGENCE_BASE = "/intelligence";
const PROJECT_LABEL = "Ledgerline";
const ORGANIZATION_LABEL = "Halcyon Labs";
const ACCOUNT_LABEL = "Maya Chen";

interface NavItem {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly to?: string;
  readonly statusLabel?: string;
}

const PRIMARY: readonly NavItem[] = [
  { icon: House, label: "Overview", to: `${INTELLIGENCE_BASE}/overview` },
  { icon: Lightbulb, label: "Product Insights" },
  { icon: ChartNoAxesCombined, label: "Product Analytics" },
  {
    icon: GraduationCap,
    label: "Automatic Learning",
    to: `${INTELLIGENCE_BASE}/learning`,
  },
  {
    icon: ClipboardCheck,
    label: "Eval candidates",
    to: `${INTELLIGENCE_BASE}/evals`,
    statusLabel: "New",
  },
  {
    icon: SlidersHorizontal,
    label: "Fine-tune",
    to: `${INTELLIGENCE_BASE}/fine-tune`,
    statusLabel: "New",
  },
  {
    icon: FileOutput,
    label: "Data export",
    to: `${INTELLIGENCE_BASE}/export`,
    statusLabel: "New",
  },
];
const RESOURCES: readonly NavItem[] = [
  { icon: MessagesSquare, label: "Threads" },
  {
    icon: RouteIcon,
    label: "User Trajectories",
    to: `${INTELLIGENCE_BASE}/trajectories`,
  },
  { icon: Brain, label: "User Memories" },
  { icon: KeyRound, label: "API Keys" },
];

function isCurrent(pathname: string, to: string): boolean {
  if (to === `${INTELLIGENCE_BASE}/overview` && pathname === INTELLIGENCE_BASE)
    return true;
  if (
    to === `${INTELLIGENCE_BASE}/trajectories` &&
    pathname.startsWith(`${INTELLIGENCE_BASE}/threads/`)
  )
    return true;
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** `NavGroup`: one labelled group of rail destinations. */
function NavGroup(props: {
  readonly items: readonly NavItem[];
  readonly label?: string;
}) {
  const { pathname } = useLocation();
  const railCollapsed = useWorkspaceRailCollapsed();
  return (
    <div className="cpki-nav-group">
      {props.label ? (
        <p className="shell-nav-group-label">{props.label}</p>
      ) : null}
      {props.items.map((item) => {
        const Icon = item.icon;
        const content = (
          <>
            <span aria-hidden="true" className="cpki-nav-item__icon">
              <Icon size={20} strokeWidth={1.8} />
            </span>
            <span className="cpki-nav-item__label">{item.label}</span>
            {item.statusLabel ? (
              <Badge className="cpki-nav-item__badge" variant="accent">
                {item.statusLabel}
              </Badge>
            ) : null}
          </>
        );
        const title = railCollapsed ? undefined : item.label;
        const active = item.to !== undefined && isCurrent(pathname, item.to);
        const control =
          item.to === undefined ? (
            <span
              aria-label={item.label}
              aria-disabled="true"
              className="cpki-nav-item cpki-nav-item--disabled"
              title={title}
            >
              {content}
            </span>
          ) : (
            <Link
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={
                active ? "cpki-nav-item cpki-nav-item--active" : "cpki-nav-item"
              }
              title={title}
              to={item.to}
            >
              {content}
            </Link>
          );
        return (
          <WorkspaceRailTooltip content={item.label} key={item.label}>
            {control}
          </WorkspaceRailTooltip>
        );
      })}
    </div>
  );
}

/** `WorkspaceSidebar`: the project's two navigation groups. */
function WorkspaceSidebar() {
  return (
    <nav className="shell-sidebar" aria-label="Primary navigation">
      <NavGroup items={PRIMARY} />
      <NavGroup label="Project resources" items={RESOURCES} />
    </nav>
  );
}

/** `WorkspaceProjectPicker`, over the demo's one project. */
function ProjectPicker() {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const railCollapsed = useWorkspaceRailCollapsed();
  return (
    <div
      className="workspace-project-picker"
      ref={pickerRef}
      title={railCollapsed ? undefined : PROJECT_LABEL}
    >
      <PopoverRoot modal open={open} onOpenChange={setOpen}>
        <WorkspaceRailTooltip content={PROJECT_LABEL}>
          <PopoverTrigger asChild>
            <button
              aria-label={`Select project: ${PROJECT_LABEL}`}
              className="workspace-project-picker__trigger"
              type="button"
            >
              <FolderOpen aria-hidden="true" size={17} />
              <span>{PROJECT_LABEL}</span>
              <ChevronsUpDown aria-hidden="true" size={14} />
            </button>
          </PopoverTrigger>
        </WorkspaceRailTooltip>
        <PopoverContent
          align="start"
          aria-label="Choose project"
          className="workspace-project-picker__panel"
          portalContainer={pickerRef.current}
          sideOffset={6}
        >
          <div className="workspace-project-picker__options">
            <button
              className="workspace-project-picker__all"
              type="button"
              onClick={() => setOpen(false)}
            >
              <LayoutGrid aria-hidden="true" size={15} />
              <span>All projects</span>
            </button>
            <div
              className="workspace-project-picker__results"
              data-scroll-fade=""
            >
              <Link
                to={`${INTELLIGENCE_BASE}/overview`}
                onClick={() => setOpen(false)}
              >
                <FolderOpen aria-hidden="true" size={15} />
                <span>{PROJECT_LABEL}</span>
                <Check aria-hidden="true" size={15} />
              </Link>
            </div>
          </div>
        </PopoverContent>
      </PopoverRoot>
    </div>
  );
}

/** `SessionAccountButton` in the rail, for the demo's signed-in person. */
function AccountButton() {
  return (
    <MenuRoot modal={false}>
      <WorkspaceRailTooltip content={ACCOUNT_LABEL}>
        <MenuTrigger asChild>
          <button
            aria-label={`${ACCOUNT_LABEL} account menu`}
            aria-description="Enterprise"
            className="account-menu__trigger"
            type="button"
          >
            <span className="account-menu__trigger-content">
              <span className="account-menu__avatar" aria-hidden="true">
                <span className="account-menu__avatar-fallback">MC</span>
              </span>
              <span
                aria-hidden="true"
                className="account-menu__trigger-details"
              >
                <span className="account-menu__identity-row">
                  <span
                    className="account-menu__trigger-name"
                    title={ACCOUNT_LABEL}
                  >
                    {ACCOUNT_LABEL}
                  </span>
                </span>
                <span className="account-menu__context-row">
                  <small title={ORGANIZATION_LABEL}>{ORGANIZATION_LABEL}</small>
                  <Badge
                    className="account-menu__plan-badge"
                    size="sm"
                    variant="sidebar"
                  >
                    Enterprise
                  </Badge>
                </span>
              </span>
              <ChevronsUpDown
                aria-hidden="true"
                className="account-menu__trigger-caret"
                size={14}
              />
            </span>
          </button>
        </MenuTrigger>
      </WorkspaceRailTooltip>
      <MenuContent
        align="start"
        side="top"
        sideOffset={8}
        className="workspace-account-menu"
        landmarkLabel="Account actions"
        aria-label="Account menu"
      >
        <MenuItem>
          <UserRound aria-hidden="true" size={16} />
          Account settings
        </MenuItem>
        <MenuItem>
          <SlidersHorizontal aria-hidden="true" size={16} />
          Organization settings
        </MenuItem>
        <MenuItem>
          <Building2 aria-hidden="true" size={16} />
          Switch organization
        </MenuItem>
        <MenuSeparator />
        <MenuItem>
          <LogOut aria-hidden="true" size={16} />
          Sign out
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}

/** `WorkspaceRail`: logo, project picker, navigation, resources, account. */
function WorkspaceRail(props: { readonly onNavigate: () => void }) {
  return (
    <aside aria-label="Workspace sidebar" className="workspace-rail">
      <div className="workspace-rail__brand">
        <Link aria-label="Go to Home" to={`${INTELLIGENCE_BASE}/overview`}>
          {/* eslint-disable @next/next/no-img-element -- the shell's own static logos */}
          <img
            alt="CopilotKit"
            className="workspace-rail__logo workspace-rail__logo--light"
            src="/intelligence-ui/logo.svg"
          />
          <img
            alt=""
            className="workspace-rail__logo workspace-rail__logo--dark"
            src="/intelligence-ui/logo-dark.svg"
          />
          <img
            alt=""
            className="workspace-rail__logo workspace-rail__logo--mark"
            src="/intelligence-ui/mark.svg"
          />
          {/* eslint-enable @next/next/no-img-element */}
        </Link>
      </div>
      <ProjectPicker />
      <div
        className="workspace-rail__navigation"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) props.onNavigate();
        }}
      >
        <WorkspaceSidebar />
      </div>
      <div className="workspace-rail__resources">
        <WorkspaceRailTooltip content="Documentation">
          <a
            href="https://docs.copilotkit.ai/"
            rel="noopener noreferrer"
            target="_blank"
          >
            <BookOpen aria-hidden="true" size={16} />
            Documentation
            <ArrowUpRight aria-hidden="true" size={13} />
          </a>
        </WorkspaceRailTooltip>
        <WorkspaceRailTooltip content="GitHub">
          <a
            href="https://github.com/CopilotKit/CopilotKit"
            rel="noopener noreferrer"
            target="_blank"
          >
            <Github aria-hidden="true" size={16} />
            GitHub
            <ArrowUpRight aria-hidden="true" size={13} />
          </a>
        </WorkspaceRailTooltip>
      </div>
      <div className="workspace-rail__account">
        <AccountButton />
      </div>
    </aside>
  );
}

/** Live / Sample indicator, in the slot where the real app shows its version. */
function ShellVersion() {
  const source = useDataSource();
  useEffect(() => {
    void probe();
    const timer = window.setInterval(() => void probe(), 8000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div
      className="shell-version"
      data-source={source}
      title="Where these screens read their data"
    >
      {source === "live"
        ? "live data"
        : source === "sample"
          ? "sample data"
          : "connecting"}
    </div>
  );
}

export interface ShellCrumb {
  readonly label: string;
  readonly to?: string;
}

/** `WorkspaceHeader`: rail toggle, scope breadcrumb, help and theme. */
function WorkspaceHeader(props: {
  readonly crumbs: readonly ShellCrumb[];
  readonly hasSidebar: boolean;
  readonly isMobile: boolean;
  readonly navigationTriggerRef: React.RefObject<HTMLButtonElement | null>;
  readonly onOpenNavigation: () => void;
}) {
  const trail: ShellCrumb[] = [
    { label: PROJECT_LABEL, to: `${INTELLIGENCE_BASE}/overview` },
    ...props.crumbs,
  ];
  return (
    <header className="shell-topbar">
      <div className="shell-topbar__brand">
        {props.hasSidebar ? (
          <button
            aria-label={props.isMobile ? "Open navigation" : "Toggle sidebar"}
            className="workspace-mobile-trigger"
            onClick={props.onOpenNavigation}
            ref={props.navigationTriggerRef}
            type="button"
          >
            <PanelLeft aria-hidden="true" size={17} />
          </button>
        ) : null}
        <div className="shell-scope" aria-label="Current workspace">
          {trail.map((crumb, index) => {
            const last = index === trail.length - 1;
            return (
              <span
                key={`${crumb.label}-${index}`}
                style={{ display: "contents" }}
              >
                {index > 0 ? (
                  <ChevronRight
                    aria-hidden="true"
                    className="shell-scope__divider"
                    size={14}
                  />
                ) : null}
                {crumb.to && !last ? (
                  <Link
                    className="shell-scope__selector shell-scope__selector--link"
                    to={crumb.to}
                  >
                    <span className="shell-scope__label">{crumb.label}</span>
                  </Link>
                ) : (
                  <span
                    aria-current={last ? "page" : undefined}
                    className="shell-scope__selector shell-scope__selector--static"
                  >
                    <span className="shell-scope__label">{crumb.label}</span>
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>
      <ShellVersion />
      <div className="shell-topbar__actions">
        <LinkButton
          className="managed-conversion-action"
          href="https://www.copilotkit.ai/contact"
          rel="noopener noreferrer"
          size="sm"
          target="_blank"
          variant="quiet"
        >
          <MessagesSquare aria-hidden="true" size={14} />
          <span>Talk to an engineer</span>
        </LinkButton>
        <WorkspaceThemeMenu />
      </div>
    </header>
  );
}

/** `ManagedServiceShellFrame`: the workspace frame around one page. */
export function IntelligenceShell(props: {
  readonly children: ReactNode;
  /** The page's section crumb, after the project. */
  readonly section?: ShellCrumb;
  /** Deeper crumbs (a record, then its view). */
  readonly detail?: string | readonly ShellCrumb[];
}) {
  // The workspace theme lives on the document root (WORKSPACE-DESIGN.md); give
  // it back when leaving /intelligence for a page of another app.
  useEffect(() => () => clearWorkspaceTheme(), []);
  const crumbs: ShellCrumb[] = [
    ...(props.section ? [props.section] : []),
    ...(typeof props.detail === "string"
      ? [{ label: props.detail }]
      : (props.detail ?? [])),
  ];
  return (
    <WorkspaceShellFrame
      header={(controls) => <WorkspaceHeader crumbs={crumbs} {...controls} />}
      rail={(onNavigate) => <WorkspaceRail onNavigate={onNavigate} />}
    >
      {props.children}
    </WorkspaceShellFrame>
  );
}
