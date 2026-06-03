"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import styles from "./threads-drawer.module.css";

export function ThreadsPanelGate({ children }: { children: React.ReactNode }) {
  // The Threads drawer reads a client-only external store (useThreads /
  // useSyncExternalStore) with no server snapshot, so it must not render during
  // SSR/prerender — Next would fail to prerender "/". Defer to client mount.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (process.env.NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED === "true") {
    if (!mounted) {
      // SSR / first-paint placeholder: reserve the drawer's width, nothing
      // interactive, light surface so there's no dark flash before mount.
      return (
        <div
          aria-hidden
          style={{
            width: "18rem",
            flexShrink: 0,
            background: "var(--card)",
            borderRight: "1px solid var(--border)",
          }}
        />
      );
    }
    return <>{children}</>;
  }

  return (
    <aside aria-label="Threads (locked)" className={styles.lockedPanel}>
      <div className={styles.drawerHeader}>
        <div className={styles.drawerHeaderMain}>
          <h2 className={styles.drawerTitle}>Threads</h2>
        </div>
      </div>
      <div className={styles.lockedBody}>
        <div className={styles.lockedCard}>
          <span aria-hidden className={styles.lockedIcon}>
            <Lock size={18} />
          </span>
          <div className={styles.lockedHeading}>
            <h3 className={styles.lockedTitle}>
              Threads is a licensed feature
            </h3>
            <p className={styles.lockedDescription}>
              Unlock persistent conversation history, multi-session context, and
              thread management with CopilotKit Intelligence.
            </p>
          </div>
          <div className={styles.lockedCommand}>
            <code className={styles.lockedCommandCode}>
              copilotkit add-intelligence
            </code>
          </div>
          <button
            type="button"
            className={styles.lockedCta}
            onClick={() =>
              window.open(
                "https://docs.copilotkit.ai/intelligence",
                "_blank",
                "noopener,noreferrer",
              )
            }
          >
            Learn more
          </button>
        </div>
      </div>
    </aside>
  );
}
