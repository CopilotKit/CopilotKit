"use client"

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
    collapsable ? true : false
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
        <span className="font-mono text-neutral-600 py-1 px-2 rounded-md bg-neutral-100 text-xs font-semibold">
          {type}
        </span>
        {required && (
          <span className="font-mono text-neutral-600 py-1 px-2 rounded-md bg-red-200 text-xs font-semibold">
            required
          </span>
        )}
        {deprecated && (
          <span className="font-mono text-neutral-600 py-1 px-2 rounded-md bg-yellow-200 text-xs font-semibold">
            deprecated
          </span>
        )}
      </>
    );
  };

  return (
    <div className="ck-property-reference py-4 space-y-3 text-sm">
      <div className="flex justify-betweem items-center">
        <div className="flex-1 space-x-3">
          {collapsable ? (
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="flex gap-x-2 items-center font-mono font-semibold text-indigo-600"
            >
              {isCollapsed ? <FaCaretRight /> : <FaCaretDown />}
              {name}
              {renderChips()}
            </button>
          ) : (
            <span className="flex gap-x-2 items-center font-mono font-semibold text-indigo-600">
              {name}
              {renderChips()}
            </span>
          )}
        </div>

        <div>
          {cloudOnly && (
            <span className="flex space-x-1 items-center justify-center bg-indigo-500 text-white py-1 px-2 rounded-md text-xs font-semibold">
              <IoSparklesSharp className="w-3 h-3" />
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
