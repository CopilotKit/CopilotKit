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
//   2. Reads the saved map from localStorage and, for every folder
//      trigger whose current `data-state` differs from the saved value,
//      clicks the trigger to restore the saved state.
//   3. Attaches a delegated `click` listener on `#nd-sidebar` that
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

const STORAGE_KEY = "shell-docs-sidebar-folders";
const SKIP_INITIAL_ANIMATION_ATTR = "data-shell-docs-skip-initial-animation";

type FolderStateMap = Record<string, "open" | "closed">;

function readStateMap(): FolderStateMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as FolderStateMap;
    }
  } catch (err) {
    // Corrupted JSON, SecurityError (third-party iframe / privacy
    // mode), or quota — log so a user reporting "my folders keep
    // resetting" can diagnose, then start fresh below.
    console.warn("[sidebar-folder-state-preserver] failed to read state", err);
  }
  return {};
}

function writeStateMap(map: FolderStateMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    // Same rationale as the read side — non-critical state, but log so
    // a quota / access error doesn't silently swallow the failure.
    console.warn("[sidebar-folder-state-preserver] failed to write state", err);
  }
}

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
    const saved = readStateMap();
    const triggers = findFolderTriggers();
    markInitialFolderAnimations(triggers);
    for (const trigger of triggers) {
      const key = folderKey(trigger);
      if (!key) continue;
      const desired = saved[key];
      if (desired === undefined) continue;
      const current = trigger.getAttribute("data-state");
      if (current !== desired) {
        // Mark BEFORE dispatching so the delegated click handler that
        // fires synchronously on `.click()` sees the marker and skips
        // recording. Cleared on the next rAF — by then any genuine
        // user-initiated click will have a fresh, unmarked event.
        syntheticClicks.add(trigger);
        trigger.click();
        requestAnimationFrame(() => syntheticClicks.delete(trigger));
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
        const map = readStateMap();
        if (map[key] === state) return;
        map[key] = state;
        writeStateMap(map);
      });
    };

    sidebar.addEventListener("click", onClick);
    return () => {
      sidebar.removeEventListener("click", onClick);
    };
  }, []);

  return null;
}
