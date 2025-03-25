import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponseRendererIconProps,
  SkeletonLoaderProps,
  StateItemRendererProps,
  StateRendererProps,
} from "@/types";

/**
 * Default expand icon component
 */
const DefaultExpandIcon: React.FC<ResponseRendererIconProps> = ({
  className,
}) => (
  <svg
    className={className}
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
);

/**
 * Default collapse icon component
 */
const DefaultCollapseIcon: React.FC<ResponseRendererIconProps> = ({
  className,
}) => (
  <svg
    className={className}
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="18 15 12 9 6 15"></polyline>
  </svg>
);

/**
 * Default loader icon component
 */
const DefaultLoaderIcon: React.FC<ResponseRendererIconProps> = ({
  className,
}) => (
  <svg
    className={`${className} copilotkit-spinner`}
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
  </svg>
);

/**
 * Helper to safely format content
 */
const formatContent = (result: unknown): string => {
  if (result === null || result === undefined) return "";
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
};

/**
 * Default skeleton loader component
 */
const DefaultSkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  className,
}) => (
  <div className={className || "copilotkit-skeleton"}>
    <div className="copilotkit-skeleton-header">
      <div className="copilotkit-skeleton-title"></div>
      <div className="copilotkit-skeleton-subtitle"></div>
    </div>
    <div className="copilotkit-skeleton-content"></div>
  </div>
);

/**
 * Default state item renderer component
 */
const DefaultStateItemRenderer: React.FC<StateItemRendererProps> = ({
  item,
  isNewest,
  className,
}) => (
  <div
    className={`${className || "copilotkit-state-item"} ${
      isNewest ? "copilotkit-state-item-newest" : ""
    }`}
  >
    <div className="copilotkit-state-item-header">
      {"tool" in item ? item.tool : item.name}
    </div>

    {"thought" in item && item.thought && (
      <div className="copilotkit-state-item-thought">{item.thought}</div>
    )}

    {"result" in item && item.result !== undefined && item.result !== null && (
      <div className="copilotkit-state-item-result">
        {formatContent(item.result)}
      </div>
    )}

    {"description" in item && item.description && (
      <div className="copilotkit-state-item-description">
        {item.description}
      </div>
    )}
  </div>
);

/**
 * Default state renderer component
 */
export const DefaultStateRenderer: React.FC<StateRendererProps> = ({
  state,
  status,
  StateItemRenderer = DefaultStateItemRenderer,
  SkeletonLoader = DefaultSkeletonLoader,
  labels,
  icons,
  className = "copilotkit-state",
  contentClassName = "copilotkit-state-content",
  itemClassName = "copilotkit-state-item",
  maxHeight = "250px",
  defaultCollapsed = true,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevItemsLengthRef = useRef<number>(0);
  const [newestItemId, setNewestItemId] = useState<string | null>(null);

  // Default label values
  const defaultLabels = {
    inProgressLabel: "Analyzing",
    completeLabel: "Analyzed",
    emptyLabel: "No activity",
  };

  // Merge provided labels with defaults
  const mergedLabels = { ...defaultLabels, ...labels };

  // Decide which icon to display
  const ExpandIcon = icons?.expand || DefaultExpandIcon;
  const CollapseIcon = icons?.collapse || DefaultCollapseIcon;

  // Safely compute derived values using useMemo
  const items = useMemo(() => {
    return state
      ? [
          ...(state.steps?.filter((s) => s.tool) || []),
          ...(state.tasks || []),
        ].sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
      : [];
  }, [state]);

  // Determine if we should show skeleton UI (thinking but no items yet)
  const isThinking = status === "inProgress" && items.length === 0;

  // Track newest item and auto-scroll
  useEffect(() => {
    if (!state) return; // Skip effect if no state

    // If new items were added
    if (items.length > prevItemsLengthRef.current) {
      // Get the newest item
      if (items.length > 0) {
        const newest = items[items.length - 1];
        setNewestItemId(newest.id);

        // Clear the animation after 1.5 seconds
        setTimeout(() => {
          setNewestItemId(null);
        }, 1500);
      }

      // Auto-scroll to bottom
      if (contentRef.current && !isCollapsed) {
        contentRef.current.scrollTop = contentRef.current.scrollHeight;
      }
    }

    prevItemsLengthRef.current = items.length;
  }, [items, isCollapsed, state]);

  // Early return for loading state with no state
  if (!state) {
    return (
      <div className={className}>
        <DefaultLoaderIcon className="copilotkit-loader" />
      </div>
    );
  }

  // Don't render anything if collapsed and empty and not thinking
  if (isCollapsed && items.length === 0 && !isThinking) return null;

  return (
    <div className={className}>
      {/* Header with toggle */}
      <div
        className="copilotkit-state-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        {isCollapsed ? (
          <ExpandIcon className="copilotkit-icon" />
        ) : (
          <CollapseIcon className="copilotkit-icon" />
        )}
        <div className="copilotkit-state-label">
          {status === "inProgress" ? (
            <span className="copilotkit-state-label-loading">
              {mergedLabels.inProgressLabel}
            </span>
          ) : (
            mergedLabels.completeLabel
          )}
        </div>
      </div>

      {/* Content area */}
      {!isCollapsed && (
        <div
          ref={contentRef}
          className={contentClassName}
          style={{ maxHeight }}
        >
          {/* Render items if available */}
          {items.length > 0 ? (
            items.map((item) => (
              <StateItemRenderer
                key={item.id}
                item={item}
                isNewest={item.id === newestItemId}
                className={itemClassName}
              />
            ))
          ) : isThinking ? (
            // Show skeleton loader while thinking
            <>
              <SkeletonLoader />
              <SkeletonLoader />
            </>
          ) : (
            // Empty state
            <div className="copilotkit-state-empty">
              {mergedLabels.emptyLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
