import React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";

/**
 * Executes a bundled IIFE string by appending a nonced <script> element to
 * document.body. CSP requires nonce-scoped scripts in VS Code webviews; the
 * nonce is injected into the webview HTML as window.__copilotkit_nonce by
 * the extension host (see panel.ts).
 *
 * Returns the value of window.__copilotkit_hookSite after execution.
 */
export function executeBundle(code: string): unknown {
  (window as unknown as { __copilotkit_deps: unknown }).__copilotkit_deps = {
    React,
    ReactDOM,
    ReactDOMClient,
    JSXRuntime,
  };
  const nonce = (window as unknown as { __copilotkit_nonce?: string })
    .__copilotkit_nonce;
  const script = document.createElement("script");
  if (nonce) script.setAttribute("nonce", nonce);
  script.textContent = code;
  document.body.appendChild(script);
  document.body.removeChild(script);
  return (window as unknown as { __copilotkit_hookSite?: unknown })
    .__copilotkit_hookSite;
}
