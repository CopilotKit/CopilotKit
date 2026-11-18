import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { useMotionPreference } from "../ui";
import { Skeleton } from "../ui/feedback";

/**
 * Announces pending work immediately, but only paints a placeholder for slow
 * requests. Mount while loading and unmount as soon as content is ready;
 * content never waits for the placeholder or a minimum display time.
 */
export function WorkspaceLoading({
  children,
  label,
}: {
  readonly children?: ReactNode;
  /** Omit when the page already owns a persistent loading live region. */
  readonly label?: string;
}): React.JSX.Element {
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const reducedMotion = useMotionPreference();
  useEffect(() => {
    const timer = window.setTimeout(() => setShowPlaceholder(true), 250);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "status" : undefined}
    >
      {label ? <span className="cpki-visually-hidden">{label}</span> : null}
      {showPlaceholder ? (
        <motion.div
          aria-hidden="true"
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reducedMotion ? 0 : 0.12 }}
        >
          {children ?? (
            <div className="workspace-loading-panel">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          )}
        </motion.div>
      ) : null}
    </div>
  );
}
