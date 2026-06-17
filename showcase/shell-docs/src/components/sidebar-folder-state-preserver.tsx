// SidebarFolderStatePreserver — persists the open/closed state of
// Fumadocs sidebar folders (Radix Collapsibles) across navigations.
//
// The sidebar is rendered per-page inside `ShellDocsLayout`, so each
// click on a sidebar link unmounts and remounts the whole tree.
// Fumadocs reinitializes each folder collapsible to its own default
// open/closed state on remount, which means a user who collapsed
// "Generative UI > Controlled" sees it re-expand the moment they
// navigate. This is jarring for long sidebars where users curate
// what they want visible.
//
// This component:
//   1. On mount and on every URL change, marks the current folder panels
//      so Fumadocs's mount-time collapsible animation is suppressed.
//   2. Opens any folder containing the selected page for the current
//      route. For other folders, reads the saved map from localStorage
//      and clicks triggers whose current `data-state` differs from the
//      saved value.
//   3. Consumes one-shot folder-open requests from other controls, like
//      the frontend quickstart picker, without overwriting saved user
//      preferences.
//   4. Attaches a delegated `click` listener on `#nd-sidebar` that
//      records each folder's new `data-state` (read on the next
//      animation frame, after Radix has updated it) into the map.
//
// Why localStorage (not sessionStorage like the scroll preserver):
// scroll position is ephemeral and tab-scoped, but folder
// open/closed preferences feel like a user setting — closing
// "Reference" once should keep it closed tomorrow.
//
// Why use the trigger's text content as the key: folder trigger
// labels (e.g. "Generative UI", "Controlled") are stable across
// pages because the same page-tree drives the sidebar on every
// route. Radix's `aria-controls` id is randomized per mount, so it
// can't be used.
//
// Mounted once, inside `ShellDocsLayout`. Renders nothing.

"use client";

import { useEffect, useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import {
  consumeSidebarFolderOpenOnce,
  readSidebarFolderState,
  resolveSidebarFolderDesiredState,
  SIDEBAR_FOLDER_OPEN_REQUEST_EVENT,
  sidebarHrefMatchesPathname,
  writeSidebarFolderState,
} from "@/lib/sidebar-folder-state";

const SKIP_INITIAL_ANIMATION_ATTR = "data-shell-docs-skip-initial-animation";

// Fumadocs folder triggers are <button>s that toggle a sibling
// Collapsible. They carry `data-state="open" | "closed"` and an
// `aria-controls="radix-..."` pointing at the panel.
function findFolderTriggers(): HTMLButtonElement[] {
  const sidebar = document.getElementById("nd-sidebar");
  if (!sidebar) return [];
  return Array.from(
    sidebar.querySelectorAll<HTMLButtonElement>(
      "button[aria-controls^='radix-'][data-state]",
    ),
  );
}

function folderKey(trigger: HTMLButtonElement): string {
  return (trigger.innerText || trigger.textContent || "").trim();
}

function findFolderContent(trigger: HTMLButtonElement): HTMLElement | null {
  const id = trigger.getAttribute("aria-controls");
  if (!id) return null;
  return document.getElementById(id);
}

function markInitialFolderAnimations(triggers: HTMLButtonElement[]) {
  for (const trigger of triggers) {
    findFolderContent(trigger)?.setAttribute(SKIP_INITIAL_ANIMATION_ATTR, "");
  }
}

function enableFolderAnimation(trigger: HTMLButtonElement) {
  findFolderContent(trigger)?.removeAttribute(SKIP_INITIAL_ANIMATION_ATTR);
}

function folderContainsSelectedPage(
  trigger: HTMLButtonElement,
  pathname: string,
) {
  const content = findFolderContent(trigger);
  if (!content) return false;
  const origin = window.location.origin;
  return Array.from(content.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .map((link) => link.getAttribute("href"))
    .some((href) =>
      href ? sidebarHrefMatchesPathname(href, pathname, origin) : false,
    );
}

function clickWithoutPersisting(trigger: HTMLButtonElement) {
  // Mark BEFORE dispatching so the delegated click handler that fires
  // synchronously on `.click()` sees the marker and skips recording.
  // Cleared on the next rAF — by then any genuine user-initiated click
  // will have a fresh, unmarked event.
  syntheticClicks.add(trigger);
  trigger.click();
  requestAnimationFrame(() => syntheticClicks.delete(trigger));
}

function openFolderByKey(key: string) {
  const triggers = findFolderTriggers();
  for (const trigger of triggers) {
    if (folderKey(trigger) !== key) continue;
    if (trigger.getAttribute("data-state") !== "open") {
      clickWithoutPersisting(trigger);
    }
  }
}

// Triggers we just synthetically clicked during a restore pass. The
// delegated click handler skips these so a restore-driven click doesn't
// get recorded back into localStorage — without this guard a Radix
// state mismatch (transient animation, mount race) could overwrite the
// user's saved preference with the live value the restore just tried
// to flip. WeakSet so removed triggers GC cleanly across navigations.
const syntheticClicks = new WeakSet<HTMLButtonElement>();

export function SidebarFolderStatePreserver() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    // Restore saved state. Because Fumadocs renders the sidebar
    // synchronously, the triggers exist by the time this layout effect
    // runs. Mark panels before Fumadocs's own effect adds animation
    // classes so route-mounted open folders do not animate on every
    // page navigation. Real user clicks remove the marker below, so
    // interactive open/close still animates normally.
    const saved = readSidebarFolderState();
    const triggers = findFolderTriggers();
    markInitialFolderAnimations(triggers);
    for (const trigger of triggers) {
      const key = folderKey(trigger);
      if (!key) continue;
      const desired = resolveSidebarFolderDesiredState({
        containsSelectedPage: folderContainsSelectedPage(trigger, pathname),
        openOnceRequested: consumeSidebarFolderOpenOnce(key),
        savedState: saved[key],
      });
      if (desired === undefined) continue;
      const current = trigger.getAttribute("data-state");
      if (current !== desired) {
        clickWithoutPersisting(trigger);
      }
    }
  }, [pathname]);

  useEffect(() => {
    const sidebar = document.getElementById("nd-sidebar");
    if (!sidebar) return;

    // Delegated click handler — Fumadocs may rerender individual
    // folder rows, but `#nd-sidebar` itself is stable for the
    // lifetime of the layout.
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const trigger = target.closest<HTMLButtonElement>(
        "button[aria-controls^='radix-'][data-state]",
      );
      if (!trigger || !sidebar.contains(trigger)) return;
      // Skip synthetic restore clicks — only record real user clicks.
      if (syntheticClicks.has(trigger)) return;
      enableFolderAnimation(trigger);

      const key = folderKey(trigger);
      if (!key) return;

      // Radix updates `data-state` on the same tick as the click but
      // after this handler returns. `requestAnimationFrame` reads it
      // after that update lands.
      requestAnimationFrame(() => {
        const state = trigger.getAttribute("data-state");
        if (state !== "open" && state !== "closed") return;
        const map = readSidebarFolderState();
        if (map[key] === state) return;
        map[key] = state;
        writeSidebarFolderState(map);
      });
    };

    const onOpenRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ folder?: unknown }>).detail;
      if (typeof detail?.folder !== "string") return;
      openFolderByKey(detail.folder);
    };

    sidebar.addEventListener("click", onClick);
    window.addEventListener(SIDEBAR_FOLDER_OPEN_REQUEST_EVENT, onOpenRequest);
    return () => {
      sidebar.removeEventListener("click", onClick);
      window.removeEventListener(
        SIDEBAR_FOLDER_OPEN_REQUEST_EVENT,
        onOpenRequest,
      );
    };
  }, []);

  return null;
}
