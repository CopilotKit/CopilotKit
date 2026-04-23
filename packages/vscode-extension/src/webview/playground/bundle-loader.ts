import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";
import { createForwardingStubs } from "./forwarding-stubs";

declare global {
  interface Window {
    __copilotkit_playground?: { PlaygroundEntry: React.ComponentType };
    __copilotkit_deps?: Record<string, unknown>;
    __copilotkit_nonce?: string;
  }
}

export interface PlaygroundBundleExports {
  PlaygroundEntry: React.ComponentType;
}

/**
 * In vitest's `setupVM` jsdom mode the Node.js VM context (globalThis / window)
 * and the JSDOM window object are two different references. Scripts injected via
 * `<script>textContent</script>` execute in the JSDOM window, so their globals
 * land on `jsdom.window` rather than on the VM's `globalThis`. This helper
 * returns the window object that injected scripts will actually write to.
 *
 * In production (VS Code webview) or in vitest's `setup` mode, `window` IS
 * the same object that injected scripts use, so the helper just returns `window`.
 */
function getScriptWindow(): Window & typeof globalThis {
  // vitest setupVM attaches the JSDOM instance as `global.jsdom`.
  // When it does, `global.jsdom.window` is the real JSDOM window that scripts run in.
  const maybeJsdom = (
    globalThis as unknown as { jsdom?: { window?: Window & typeof globalThis } }
  ).jsdom;
  if (
    maybeJsdom?.window &&
    maybeJsdom.window !== (globalThis as unknown as Window)
  ) {
    return maybeJsdom.window;
  }
  return window;
}

/**
 * Installs deps (React, CopilotKit stubs) on the window, injects the IIFE
 * bundle as a nonced <script>, reads the resulting global, and resolves
 * with the entry component.
 *
 * Uses script-tag injection rather than eval/new Function because the
 * webview's CSP is `script-src 'nonce-X'` without 'unsafe-eval'. The
 * same pattern powers hook-preview's bundle loader — see
 * `packages/vscode-extension/src/webview/hook-preview/bundle-loader.ts`.
 *
 * In production (VS Code webview), the nonce must be present on
 * `window.__copilotkit_nonce` so the script passes the CSP check.
 *
 * In tests (vitest + jsdom setupVM), scripts execute in the JSDOM window;
 * results are synced back to the VM global context automatically.
 */
export function executePlaygroundBundle(
  code: string,
): Promise<PlaygroundBundleExports> {
  return new Promise((resolve, reject) => {
    const deps = {
      React,
      ReactDOM,
      ReactDOMClient,
      JSXRuntime,
      copilotkitStubs: createForwardingStubs(),
    };

    try {
      // Always set on the current global so test assertions on `window` work.
      window.__copilotkit_deps = deps;
    } catch (err) {
      reject(err);
      return;
    }

    // The script executes in the JSDOM window (may differ from `globalThis`
    // in vitest's setupVM mode). Install deps there so the bundle can find them.
    const scriptWin = getScriptWindow();
    const vmSplit = scriptWin !== (window as unknown as typeof scriptWin);

    if (vmSplit) {
      // In setupVM mode: write deps to jsdom window, clear any stale result.
      scriptWin.__copilotkit_deps = deps;
      scriptWin.__copilotkit_playground = undefined;
    }

    // Capture errors thrown synchronously by the injected script. jsdom
    // surfaces these via `window.error`; production webviews also fire it.
    let captured: Error | null = null;
    const onError = (ev: ErrorEvent) => {
      captured = ev.error ?? new Error(ev.message);
      ev.preventDefault();
    };
    scriptWin.addEventListener("error", onError);

    try {
      const script = scriptWin.document.createElement("script");
      const nonce = window.__copilotkit_nonce ?? scriptWin.__copilotkit_nonce;
      if (nonce) script.setAttribute("nonce", nonce);
      script.textContent = code;
      scriptWin.document.body.appendChild(script);
      scriptWin.document.body.removeChild(script);
    } finally {
      scriptWin.removeEventListener("error", onError);
    }

    if (captured) {
      reject(captured);
      return;
    }

    const exports = scriptWin.__copilotkit_playground;

    if (vmSplit) {
      // Sync result back to the VM global so callers reading `window` see it.
      window.__copilotkit_playground = exports;
    }

    if (!exports || typeof exports.PlaygroundEntry !== "function") {
      reject(
        new Error(
          "Bundle did not expose __copilotkit_playground.PlaygroundEntry",
        ),
      );
      return;
    }
    resolve(exports);
  });
}
