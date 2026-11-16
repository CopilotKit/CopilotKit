import React, { createContext, useContext } from "react";
import type { ComponentType, ReactNode } from "react";
import { themeStyleSheet } from "@copilotkit/shared/generative-ui";
import type { GenerativeUITheme } from "./runtime-context";
import type { GenerativeUIAriaAttributes } from "./accessibility";

/** Props of {@link GenerativeUIHost.SurfaceRoot}. */
export interface GenerativeUISurfaceRootProps {
  surfaceId: string;
  /** The theme of the provider (`generativeUI.theme`). */
  theme: GenerativeUITheme | undefined;
  children: ReactNode;
}

/** Props of {@link GenerativeUIHost.AccessibilityWrapper}. */
export interface GenerativeUIAccessibilityWrapperProps {
  /**
   * The hidden state and live region of the component's envelope. A label
   * or a description needs an element with a role, so the component applies
   * those itself.
   */
  attributes: Pick<GenerativeUIAriaAttributes, "aria-hidden" | "aria-live">;
  children: ReactNode;
}

/** Props of {@link GenerativeUIHost.NodeFallback}. */
export interface GenerativeUINodeFallbackProps {
  message: string;
  /**
   * The node that cannot be shown, or `"surface"` for a whole surface that
   * failed. The marker is in the id space: a node the model named
   * `"surface"` looks the same. The error report tells the two apart (a
   * surface failure has no `componentId`).
   */
  componentId: string;
  /** Renders the node again. Given for render failures only. */
  retry?: () => void;
}

/**
 * The few host elements that a surface draws itself, around the catalog's
 * components. The defaults are DOM elements, so a platform without a DOM
 * must supply its own host through `GenerativeUIHostContext`, above every
 * surface it renders. React Native does
 * (`@copilotkit/react-native/generative-ui`), so that the same renderer runs
 * on both.
 *
 * The host and its components must keep their identity across renders:
 * define them at module scope, or memoize them. React takes a new component
 * type for a different element: a `SurfaceRoot` written inline (for example
 * `host={{ ...base, SurfaceRoot: (p) => ... }}`) remounts every surface on
 * each render of its provider, and a new `AccessibilityWrapper` remounts
 * every wrapped component, so what the user typed into them is lost.
 */
export interface GenerativeUIHost {
  /** Wraps a whole surface. Must not remount when the theme changes. */
  SurfaceRoot: ComponentType<GenerativeUISurfaceRootProps>;
  /**
   * Wraps every component that has an accessibility envelope, unless its
   * definition applies the envelope itself (`accessibility: "self"`). It
   * wraps the component whatever the envelope's values, even with no
   * `hidden` or live region set, so it must render its children in the same
   * place in either case: a bound `hidden` that toggles must not remount
   * the component and lose its local state.
   */
  AccessibilityWrapper: ComponentType<GenerativeUIAccessibilityWrapperProps>;
  /**
   * Shown in place of a component that cannot be shown: it failed to render
   * (with `retry`), its props are invalid, its type is unknown, or it is a
   * cyclic reference. It also stands in for a whole surface that failed,
   * with `componentId: "surface"`. When the app sets
   * `errorBoundary.fallback`, that replaces it for render failures, and this
   * stands in only if the app's fallback throws. If this throws, the node
   * renders nothing and the error is reported, once for each message; it is
   * tried again with a new message, a new revision of the node or Retry.
   */
  NodeFallback: ComponentType<GenerativeUINodeFallbackProps>;
}

const DISPLAY_CONTENTS = { display: "contents" } as const;

/**
 * The root element is always there, so a theme change does not remount the
 * surface. `display: contents` keeps it out of the layout, and the CSS
 * variables still reach every component of the surface. The `a2ui-surface`
 * class scopes the standard catalog's surface CSS rules. The theme is a
 * stylesheet, not an inline style, so that its `dark` values can apply in
 * dark mode only. The values are checked in `themeStyleSheet`, and the HTML
 * is set as is, so the server render keeps the quotes of the rule.
 */
function DomSurfaceRoot({
  surfaceId,
  theme,
  children,
}: GenerativeUISurfaceRootProps) {
  const sheet = React.useMemo(() => themeStyleSheet(theme), [theme]);
  return (
    <div
      className="a2ui-surface"
      data-generative-ui-root={surfaceId}
      data-a2ui-theme={sheet?.id}
      style={DISPLAY_CONTENTS}
    >
      {sheet ? <style dangerouslySetInnerHTML={{ __html: sheet.css }} /> : null}
      {children}
    </div>
  );
}

function DomAccessibilityWrapper({
  attributes,
  children,
}: GenerativeUIAccessibilityWrapperProps) {
  return (
    <span data-a2ui-accessibility="" style={DISPLAY_CONTENTS} {...attributes}>
      {children}
    </span>
  );
}

export function DefaultNodeFallback({
  message,
  componentId,
  retry,
}: GenerativeUINodeFallbackProps) {
  return (
    <div
      role="alert"
      data-generative-ui-error={componentId}
      style={{
        border: "1px solid #fca5a5",
        background: "#fef2f2",
        color: "#991b1b",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 13,
      }}
    >
      Couldn’t display this part: {message}
      {retry && (
        <button
          type="button"
          onClick={retry}
          style={{ marginLeft: 8, textDecoration: "underline" }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

/** The DOM host: what a surface draws on the web. */
export const domGenerativeUIHost: GenerativeUIHost = {
  SurfaceRoot: DomSurfaceRoot,
  AccessibilityWrapper: DomAccessibilityWrapper,
  NodeFallback: DefaultNodeFallback,
};

/**
 * The host elements of the surfaces below. Defaults to the DOM host, so a
 * web app never sets it.
 */
export const GenerativeUIHostContext =
  createContext<GenerativeUIHost>(domGenerativeUIHost);

export function useGenerativeUIHost(): GenerativeUIHost {
  return useContext(GenerativeUIHostContext);
}
