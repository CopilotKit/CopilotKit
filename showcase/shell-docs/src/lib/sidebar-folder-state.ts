export const SIDEBAR_FOLDER_STATE_STORAGE_KEY = "shell-docs-sidebar-folders";
export const SIDEBAR_FOLDER_OPEN_ONCE_STORAGE_KEY =
  "shell-docs-sidebar-open-once";
export const SIDEBAR_FOLDER_OPEN_REQUEST_EVENT =
  "shell-docs:sidebar-folder-open-request";
export const FRONTEND_QUICKSTART_FOLDER_LABEL = "Quickstart";

export type FolderStateMap = Record<string, "open" | "closed">;

export interface SidebarFolderDesiredStateInput {
  containsSelectedPage: boolean;
  openOnceRequested: boolean;
  savedState: "open" | "closed" | undefined;
}

export interface SidebarFolderStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function localFolderStorage(): SidebarFolderStorage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function sessionFolderStorage(): SidebarFolderStorage | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

function eventTarget(): Window | null {
  if (typeof window === "undefined") return null;
  return window;
}

export function readSidebarFolderState(
  storage: SidebarFolderStorage | null = localFolderStorage(),
): FolderStateMap {
  try {
    const raw = storage?.getItem(SIDEBAR_FOLDER_STATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as FolderStateMap;
    }
  } catch (err) {
    console.warn("[sidebar-folder-state-preserver] failed to read state", err);
  }
  return {};
}

export function writeSidebarFolderState(
  map: FolderStateMap,
  storage: SidebarFolderStorage | null = localFolderStorage(),
) {
  try {
    storage?.setItem(SIDEBAR_FOLDER_STATE_STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn("[sidebar-folder-state-preserver] failed to write state", err);
  }
}

export function resolveSidebarFolderDesiredState({
  containsSelectedPage,
  openOnceRequested,
  savedState,
}: SidebarFolderDesiredStateInput): "open" | "closed" | undefined {
  if (containsSelectedPage || openOnceRequested) return "open";
  return savedState;
}

function normalizePathname(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "");
}

export function sidebarHrefMatchesPathname(
  href: string,
  pathname: string,
  origin = "http://localhost",
): boolean {
  if (!href || href.startsWith("#")) return false;

  try {
    const base = new URL(origin);
    const hrefUrl = new URL(href, base);
    const currentUrl = new URL(pathname, base);
    if (hrefUrl.origin !== base.origin) return false;
    return (
      normalizePathname(hrefUrl.pathname) ===
      normalizePathname(currentUrl.pathname)
    );
  } catch {
    return false;
  }
}

export function requestSidebarFolderOpenOnce(
  folder: string,
  storage: SidebarFolderStorage | null = sessionFolderStorage(),
  target: Window | null = eventTarget(),
) {
  try {
    storage?.setItem(SIDEBAR_FOLDER_OPEN_ONCE_STORAGE_KEY, folder);
  } catch (err) {
    console.warn(
      "[sidebar-folder-state-preserver] failed to write open request",
      err,
    );
  }

  target?.dispatchEvent(
    new CustomEvent(SIDEBAR_FOLDER_OPEN_REQUEST_EVENT, {
      detail: { folder },
    }),
  );
}

export function consumeSidebarFolderOpenOnce(
  folder: string,
  storage: SidebarFolderStorage | null = sessionFolderStorage(),
): boolean {
  try {
    if (storage?.getItem(SIDEBAR_FOLDER_OPEN_ONCE_STORAGE_KEY) !== folder) {
      return false;
    }
    storage.removeItem(SIDEBAR_FOLDER_OPEN_ONCE_STORAGE_KEY);
    return true;
  } catch (err) {
    console.warn(
      "[sidebar-folder-state-preserver] failed to read open request",
      err,
    );
    return false;
  }
}
