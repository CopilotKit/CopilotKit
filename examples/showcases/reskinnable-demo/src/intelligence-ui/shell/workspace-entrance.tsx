/* eslint-disable react-hooks/set-state-in-effect -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useMotionPreference } from "../ui";

export interface WorkspaceEntranceProps {
  readonly children: ReactNode;
  readonly className?: string;
  /** Keep tables and grids stationary while their new tab body appears. */
  readonly fadeOnly?: boolean;
  readonly order?: number;
  /** Wait for the first result; later refreshes keep the mounted region steady. */
  readonly ready?: boolean;
}

/** Share the same live reduced-motion settings across existing region elements. */
export function useWorkspaceEntranceMotion(
  order = 0,
  fadeOnly = false,
  ready = true,
) {
  const [hasEntered, setHasEntered] = useState(ready);
  useEffect(() => {
    if (ready) setHasEntered(true);
  }, [ready]);
  const reducedMotion = useMotionPreference();
  return {
    initial: reducedMotion
      ? (false as const)
      : { opacity: 0, y: fadeOnly ? 0 : 5 },
    animate: {
      opacity: reducedMotion || ready || hasEntered ? 1 : 0,
      y: reducedMotion || ready || hasEntered || fadeOnly ? 0 : 5,
    },
    transition: reducedMotion
      ? { duration: 0, delay: 0 }
      : {
          type: "spring" as const,
          duration: 0.32,
          bounce: 0.18,
          delay: Math.min(Math.max(order, 0), 4) * 0.035,
        },
  };
}

/** Introduces one mounted content region without moving its page shell. */
export function WorkspaceEntrance(
  props: WorkspaceEntranceProps,
): React.JSX.Element {
  const motionSettings = useWorkspaceEntranceMotion(
    props.order,
    props.fadeOnly,
    props.ready,
  );
  return (
    <motion.div className={props.className} {...motionSettings}>
      {props.children}
    </motion.div>
  );
}
