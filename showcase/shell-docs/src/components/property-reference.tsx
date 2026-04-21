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

/**
 * Recursively walk a React children tree, cloning any PropertyReference
 * encountered at ANY depth with `collapsable: true`. Non-PropertyReference
 * elements (divs, Fragments, arbitrary wrapper components) are preserved
 * with their structure intact and their own children deep-walked in turn.
 *
 * Why: React.Children.map only visits direct children. Authors frequently
 * wrap nested PropertyReferences in layout elements (`<div>`, `<Fragment>`)
 * or MDX-emitted wrappers; without deep walking, those nested references
 * silently lose `collapsable` propagation. See caller's "Covered by:" note.
 *
 * We do NOT recurse into children whose `type` is PropertyReference itself
 * — we only clone them with the new prop and stop. Their own auto-collapse
 * logic runs at their render time with the updated prop.
 */
function deepMapPropertyReferences(node: React.ReactNode): React.ReactNode {
  return React.Children.map(node, (child) => {
    if (!React.isValidElement(child)) return child;

    // PropertyReference: enhance and stop — don't recurse into its
    // children, since that's the next PropertyReference's own concern.
    if (child.type === PropertyReference) {
      return React.cloneElement(child as React.ReactElement<Props>, {
        collapsable: true,
      });
    }

    // Any other element with children (div, Fragment, wrapper component):
    // preserve the wrapper and recurse. Elements without children pass
    // through untouched.
    const childProps = child.props as { children?: React.ReactNode };
    if (childProps && childProps.children !== undefined) {
      return React.cloneElement(
        child,
        undefined,
        deepMapPropertyReferences(childProps.children),
      );
    }

    return child;
  });
}

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

  // Detect nested <PropertyReference> children so we can auto-collapse them.
  //
  // IMPORTANT: We use *reference equality* (`child.type === PropertyReference`)
  // rather than a name check (`child.type.name === "PropertyReference"`).
  // In production builds, minifiers (Terser/SWC) rename function components to
  // short identifiers like `s` or `a`, so `.name` comparisons silently fail and
  // the `collapsable` prop never propagates. Reference equality is minifier-safe
  // because both sides point to the same function identity after bundling.
  //
  // Deep walk: React.Children.map only walks *direct* children. Previously a
  // <PropertyReference> wrapped in a <div> or <Fragment> was invisible and
  // never received `collapsable: true`. `deepMapPropertyReferences` recurses
  // into children's children, preserving the tree structure while applying
  // the enhancement to every PropertyReference it finds at any depth. That
  // lets authors use arbitrary wrapper layout (divs, fragments, etc.)
  // around nested PropertyReferences without losing auto-collapse.
  //
  // Covered by: a <PropertyReference> containing <div><PropertyReference/></div>
  // correctly renders the nested one with `collapsable: true`; direct-child
  // nesting continues to work unchanged.
  const enhancedChildren = deepMapPropertyReferences(children);

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
              type="button"
              onClick={() => setIsCollapsed(!isCollapsed)}
              aria-expanded={!isCollapsed}
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
