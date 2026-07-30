"use client";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { allSkins } from "@/shell/registry";
import { useSkinThemeReconcile } from "@/hooks/use-theme";

/**
 * The skin switcher. Lives in the shell (mounted per-skin, but chrome-generic)
 * so every skin shows the same pill row over all registered skins. Clicking
 * navigates to /<id> via client-side routing — feels instant, no reload; each
 * skin starts in its own fresh thread/world (SkinLayout remounts the runtime
 * subtree keyed by skin.id).
 *
 * Positioning is NOT a corner: the chat docks to the LEFT and both skins pin a
 * nav to an edge of the region right of it, so any corner collides with
 * something (see `.nw-selector-dock` in globals.css for the full rationale). The
 * outer `.nw-selector-dock` is a pointer-events:none strip spanning the content
 * region right of the chat; the pill inside centers there and re-enables pointer
 * events, so it can never swallow a click meant for the content or — the bug
 * this fixes — the chat's own bottom-left toggle.
 */
export function FloatingSelector({ activeId }: { activeId: string }) {
  const router = useRouter();
  // The dock lives INSIDE the theme root, so it inherits the active skin's
  // `--nw-dark-capable` declaration. Reconcile the global `.dark` signal with
  // that capability whenever a skin mounts, so a light-only skin never renders
  // dark chat chrome inherited from a dark-capable one (see useSkinThemeReconcile).
  const dockRef = useRef<HTMLDivElement>(null);
  useSkinThemeReconcile(dockRef);
  return (
    <div className="nw-selector-dock" ref={dockRef}>
      <div className="nw-selector-pill flex gap-1.5 rounded-full border border-hairline bg-surface/85 p-1.5 shadow-lift backdrop-blur">
        {allSkins().map((s) => {
          const Logo = s.identity.logo;
          const active = s.id === activeId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => router.push(`/${s.id}`)}
              aria-current={active ? "page" : undefined}
              title={s.identity.tagline}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? "bg-ink text-surface"
                  : "text-ink-muted hover:bg-surface-muted"
              }`}
            >
              <Logo className="h-4 w-4 flex-none" />
              <span className="nw-selector-pill-label">{s.identity.brand}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
