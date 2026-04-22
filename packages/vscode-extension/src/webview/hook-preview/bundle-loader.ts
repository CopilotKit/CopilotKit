import React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";
import { createCopilotkitStubs } from "./copilotkit-stubs";

/**
 * Executes a bundled IIFE string by appending a nonced <script> element to
 * document.body. CSP requires nonce-scoped scripts in VS Code webviews; the
 * nonce is injected into the webview HTML as window.__copilotkit_nonce by
 * the extension host (see panel.ts).
 *
 * Returns the value of `window.__copilotkit_hookSite` after execution.
 *
 * Inline `<script>` elements execute synchronously on insertion in all major
 * browsers, but thrown errors inside the script don't propagate to callers —
 * they fire as `error` events on `window`. We capture that event during the
 * insertion window and re-throw so the caller's try/catch sees the failure
 * instead of silently staring at an empty hookSite.
 */
/**
 * Resolves specifiers that CJS wrappers inside the bundled IIFE still call
 * via `require(...)`. Rolldown's `globals` config rewrites ESM-style
 * external references (e.g. `import React from "react"`), but CJS libs
 * wrapped by `__commonJSMin` keep their verbatim `require("react")` calls,
 * and the browser has no `require`. Intercept the small set of externals
 * we control here and fall back to a warning for everything else so a
 * missing dep doesn't take down the whole IIFE.
 */
function createRequireShim() {
  const deps: Record<string, unknown> = {
    react: React,
    "react-dom": ReactDOM,
    "react-dom/client": ReactDOMClient,
    "react/jsx-runtime": JSXRuntime,
    "react/jsx-dev-runtime": JSXRuntime,
  };
  return (spec: string): unknown => {
    if (spec in deps) return deps[spec];
    console.warn(`[hook-preview] unhandled require("${spec}") — ignoring`);
    return {};
  };
}

export function executeBundle(code: string): unknown {
  // Reset captured-hooks registry so a new load starts clean.
  (
    window as unknown as { __copilotkit_captured?: unknown[] }
  ).__copilotkit_captured = [];
  (window as unknown as { __copilotkit_deps: unknown }).__copilotkit_deps = {
    React,
    ReactDOM,
    ReactDOMClient,
    JSXRuntime,
    copilotkitStubs: createCopilotkitStubs(),
  };
  // CJS wrappers bundled inside the IIFE still invoke `require(...)`; the
  // browser has no `require` by default. Install a shim that knows our
  // React externals before executing the script.
  (window as unknown as { require: (spec: string) => unknown }).require =
    createRequireShim();
  const nonce = (window as unknown as { __copilotkit_nonce?: string })
    .__copilotkit_nonce;

  let captured: Error | null = null;
  const onError = (ev: ErrorEvent) => {
    captured = ev.error ?? new Error(ev.message);
    ev.preventDefault();
  };
  window.addEventListener("error", onError);

  try {
    const script = document.createElement("script");
    if (nonce) script.setAttribute("nonce", nonce);
    script.textContent = code;
    document.body.appendChild(script);
    document.body.removeChild(script);
  } finally {
    window.removeEventListener("error", onError);
  }

  if (captured) throw captured;

  const hookSite = (window as unknown as { __copilotkit_hookSite?: unknown })
    .__copilotkit_hookSite;
  if (hookSite === undefined) {
    throw new Error(
      "Bundle executed but did not set window.__copilotkit_hookSite — " +
        "the bundler output may be corrupted or missing its IIFE wrapper.",
    );
  }
  return hookSite;
}
