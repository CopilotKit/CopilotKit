import React, { createContext, useContext } from "react";
import { baseCss } from "./base-css";

const StyleNonceContext = createContext<string | undefined>(undefined);

/** Passes a CSP nonce to every `<CopilotStyle>` below it. */
export const CopilotStyleNonceProvider = StyleNonceContext.Provider;

/**
 * Ships a component's CSS with the component, so apps never import a stylesheet.
 *
 * React 19 hoists a `<style href precedence>` into `<head>`, renders each `href`
 * once, and includes it in the server HTML, so SSR, streaming, and client-only
 * mounts all work without framework setup. React 18 renders the tag in place,
 * which still styles the component.
 *
 * With a CSP nonce, the tags render in place instead. React only adds a nonce
 * to hoisted styles when the app renders with `nonce: { style }`, and Next.js
 * passes a plain string, so hoisted tags would be blocked.
 *
 * Every rule in `css` should sit inside `:where()`, so any class the app sets
 * wins over ours.
 */
export function CopilotStyle({ id, css }: { id: string; css: string }) {
  const nonce = useContext(StyleNonceContext);
  if (nonce) {
    return (
      <>
        <style nonce={nonce}>{baseCss}</style>
        <style nonce={nonce}>{css}</style>
      </>
    );
  }
  return (
    <>
      <style href="cpk-base" precedence="copilotkit">
        {baseCss}
      </style>
      <style href={`cpk-${id}`} precedence="copilotkit">
        {css}
      </style>
    </>
  );
}
