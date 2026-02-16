"use client";

import React from "react";
import { IoSparklesSharp } from "react-icons/io5";
import { FaCaretRight, FaCaretDown } from "react-icons/fa";

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
        <span className="text-info-muted-foreground bg-info-muted rounded-md px-2 py-1 font-mono text-xs font-semibold">
          {type}
        </span>
        {required && (
          <span className="text-error-muted-foreground bg-error-muted rounded-md px-2 py-1 font-mono text-xs font-semibold">
            required
          </span>
        )}
        {deprecated && (
          <span className="text-warning-muted-foreground bg-warning-muted rounded-md px-2 py-1 font-mono text-xs font-semibold">
            deprecated
          </span>
        )}
      </>
    );
  };

  return (
    <div className="ck-property-reference space-y-3 py-4 text-sm">
      <div className="justify-betweem flex items-center">
        <div className="flex-1 space-x-3">
          {collapsable ? (
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="flex items-center gap-x-2 font-mono font-semibold text-indigo-600"
            >
              {isCollapsed ? <FaCaretRight /> : <FaCaretDown />}
              {name}
              {renderChips()}
            </button>
          ) : (
            <span className="flex items-center gap-x-2 font-mono font-semibold text-indigo-600">
              {name}
              {renderChips()}
            </span>
          )}
        </div>

        <div>
          {cloudOnly && (
            <span className="flex items-center justify-center space-x-1 rounded-md bg-indigo-500 px-2 py-1 text-xs font-semibold text-white">
              <IoSparklesSharp className="h-3 w-3" />
              <span>COPILOT CLOUD</span>
            </span>
          )}
        </div>
      </div>
      <div className={`space-y-1 ${collapseClassName}`}>
        {defaultValue !== undefined && (
          <div>
            <span className="font-semibold">Default:</span>{" "}
            <span className="font-mono text-neutral-500">
              {typeof defaultValue === "string"
                ? `"${defaultValue}"`
                : `${defaultValue}`}
            </span>
          </div>
        )}
        <div>{enhancedChildren}</div>
      </div>
    </div>
  );
}
