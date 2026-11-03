import { useLayoutEffect, useRef } from "react";
import { Link } from "../shell/router";

import { learningContainerRoute } from "./learning-routes";
import type { LearningTabSegment } from "./learning-routes";
import styles from "./learning-page.module.css";

interface LearningSpaceTab {
  readonly count: string;
  readonly label: string;
  readonly segment: LearningTabSegment;
}

interface LearningSpaceTabsProps {
  readonly baseRoute: string;
  readonly containerId: string;
  readonly selected: LearningTabSegment;
  readonly tabs: readonly LearningSpaceTab[];
}

/** Keep the selected route link visible inside its strip without moving page scroll or focus. */
export function LearningSpaceTabs(
  props: LearningSpaceTabsProps,
): React.JSX.Element {
  const stripRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLAnchorElement>(
      'a[aria-current="page"]',
    );
    if (!active) return;

    const reveal = (): void => {
      const viewport = strip.getBoundingClientRect();
      const selected = active.getBoundingClientRect();
      if (selected.left < viewport.left) {
        strip.scrollLeft = Math.max(
          0,
          strip.scrollLeft - (viewport.left - selected.left),
        );
      } else if (selected.right > viewport.right) {
        strip.scrollLeft += selected.right - viewport.right;
      }
    };

    reveal();
    window.addEventListener("resize", reveal);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reveal);
    observer?.observe(strip);
    observer?.observe(active);
    return () => {
      window.removeEventListener("resize", reveal);
      observer?.disconnect();
    };
  }, [props.selected]);

  return (
    <nav
      aria-label="Space views"
      className={styles.tabs}
      data-slot="tabs-list"
      ref={stripRef}
    >
      {props.tabs.map((tab) => (
        <Link
          aria-current={props.selected === tab.segment ? "page" : undefined}
          data-slot="tabs-trigger"
          key={tab.segment}
          to={learningContainerRoute(
            props.baseRoute,
            props.containerId,
            tab.segment,
          )}
        >
          {tab.label}
          {tab.count ? <span data-slot="tabs-count">{tab.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
