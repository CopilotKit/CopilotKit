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
//   1. On mount and on every URL change, reads the saved map from
//      localStorage and, for every folder trigger whose current
//      `data-state` differs from the saved value, clicks the trigger
//      to restore the saved state.
//   2. Attaches a delegated `click` listener on `#nd-sidebar` that
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

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "shell-docs-sidebar-folders";

type FolderStateMap = Record<string, "open" | "closed">;

function readStateMap(): FolderStateMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as FolderStateMap;
    }
  } catch {
    // Corrupted JSON or storage access blocked — start fresh.
  }
  return {};
}

function writeStateMap(map: FolderStateMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota or access errors — silently drop; folder state is non-critical.
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

export function SidebarFolderStatePreserver() {
  const pathname = usePathname();

  useEffect(() => {
    // Restore saved state. Because Fumadocs renders the sidebar
    // synchronously, the triggers exist by the time this effect runs.
    // For each trigger whose current data-state differs from the
    // saved value, click it once to flip Radix's internal state.
    const saved = readStateMap();
    const triggers = findFolderTriggers();
    for (const trigger of triggers) {
      const key = folderKey(trigger);
      if (!key) continue;
      const desired = saved[key];
      if (desired === undefined) continue;
      const current = trigger.getAttribute("data-state");
      if (current !== desired) {
        trigger.click();
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
