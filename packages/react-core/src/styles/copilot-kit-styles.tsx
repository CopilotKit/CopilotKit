import React, { createContext, useContext } from "react";
import { stylesheet } from "@copilotkit/core/styles";

interface StyleOptions {
  /** CSP nonce for the `<style>` tag. */
  nonce?: string;
  /** `false` when the app loads `@copilotkit/core/styles.css` itself. */
  inject: boolean;
}

const StyleOptionsContext = createContext<StyleOptions>({ inject: true });

/** Passes the provider's style options to `<CopilotKitStyles>`. */
export const CopilotStyleOptionsProvider = StyleOptionsContext.Provider;

/**
 * Renders the CSS for CopilotKit's UI, so apps never import a stylesheet.
 * `CopilotChat` (and so `CopilotPopup` and `CopilotSidebar`) renders it for
 * you. Render it yourself only when you build a layout from the chat parts
 * without `CopilotChat`.
 *
 * React 19 moves the tag into `<head>` and keeps one copy, including in the
 * server HTML. React 18 renders it in place, one copy per `CopilotChat`.
 *
 * With a CSP nonce the tag always renders in place. React only adds a nonce to
 * a hoisted style when the app renders with `nonce: { style }`, and Next.js
 * passes a plain string, so a hoisted tag would be blocked.
 *
 * Renders nothing when `CopilotKitProvider` has `injectStyles={false}`.
 */
export function CopilotKitStyles() {
  const { nonce, inject } = useContext(StyleOptionsContext);
  if (!inject) {
    return null;
  }
  if (nonce) {
    return <style nonce={nonce}>{stylesheet}</style>;
  }
  return (
    <style href="copilotkit" precedence="copilotkit">
      {stylesheet}
    </style>
  );
}
