"use client";

import React from "react";

type Props = {
  name: string;
  type: string;
  required?: boolean;
  deprecated?: boolean;
  children?: React.ReactNode;
  cloudOnly?: boolean;
  default?: string;
  collapsable?: boolean;
};

export function PropertyReference({
  children,
  name,
  type,
  required = false,
  deprecated = false,
  cloudOnly = false,
  default: defaultValue,
  collapsable = false,
}: Props) {
  const [isCollapsed, setIsCollapsed] = React.useState(
    collapsable ? true : false,
  );

  const enhancedChildren = React.Children.map(children, (child) => {
    if (
      React.isValidElement(child) &&
      (child.type as any).name === "PropertyReference"
    ) {
      return React.cloneElement(child, { collapsable: true } as Props);
    }
    return child;
  });

  const collapseClassName = `${isCollapsed ? "hidden" : ""}`;

  const renderChips = () => {
    return (
      <>
        <span className="font-mono bg-blue-500/10 text-blue-400 py-0.5 px-2 rounded text-xs font-semibold">
          {type}
        </span>
        {required && (
          <span className="font-mono bg-red-500/10 text-red-400 py-0.5 px-2 rounded text-xs font-semibold">
            required
          </span>
        )}
        {deprecated && (
          <span className="font-mono bg-yellow-500/10 text-yellow-400 py-0.5 px-2 rounded text-xs font-semibold">
            deprecated
          </span>
        )}
      </>
    );
  };

  return (
    <div className="py-4 space-y-3 text-sm border-b border-[var(--border)] last:border-b-0">
      <div className="flex justify-between items-center">
        <div className="flex-1 space-x-3">
          {collapsable ? (
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="flex gap-x-2 items-center font-mono font-semibold text-[var(--accent)]"
            >
              <span className="text-xs">
                {isCollapsed ? "\u25B6" : "\u25BC"}
              </span>
              {name}
              {renderChips()}
            </button>
          ) : (
            <span className="flex gap-x-2 items-center font-mono font-semibold text-[var(--accent)]">
              {name}
              {renderChips()}
            </span>
          )}
        </div>

        <div>
          {cloudOnly && (
            <span className="flex space-x-1 items-center justify-center bg-[var(--accent)] text-white py-0.5 px-2 rounded text-xs font-semibold">
              <span>COPILOT CLOUD</span>
            </span>
          )}
        </div>
      </div>
      <div className={`space-y-1 pl-4 ${collapseClassName}`}>
        {defaultValue !== undefined && (
          <div>
            <span className="font-semibold text-[var(--text-secondary)]">
              Default:
            </span>{" "}
            <span className="font-mono text-[var(--text-muted)]">
              {typeof defaultValue === "string"
                ? `"${defaultValue}"`
                : `${defaultValue}`}
            </span>
          </div>
        )}
        <div className="text-[var(--text-secondary)]">{enhancedChildren}</div>
      </div>
    </div>
  );
}
