import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";
import { createForwardingStubs } from "./forwarding-stubs";

declare global {
  interface Window {
    __copilotkit_playground?: {
      PlaygroundEntry: React.ComponentType;
      ChatPlayground: React.ComponentType;
    };
    __copilotkit_deps?: Record<string, unknown>;
    __copilotkit_nonce?: string;
  }
}

export interface PlaygroundBundleExports {
  PlaygroundEntry: React.ComponentType;
  ChatPlayground: React.ComponentType;
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
  css?: string,
): Promise<PlaygroundBundleExports> {
  return new Promise((resolve, reject) => {
    if (css) injectBundleCss(css);
    instrumentFetch();
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

    if (
      !exports ||
      typeof exports.PlaygroundEntry !== "function" ||
      typeof exports.ChatPlayground !== "function"
    ) {
      reject(
        new Error(
          "Bundle did not expose __copilotkit_playground.PlaygroundEntry + ChatPlayground",
        ),
      );
      return;
    }
    resolve(exports);
  });
}

/**
 * Wraps `window.fetch` once so every URL the bundled webview tries to reach
 * is logged with method + status. The runtime-host already logs every
 * request that reaches it server-side; this fills in the matching client
 * side. If the chat appears to do nothing on send, the most informative
 * answer is in this output: did the webview fetch anything? If not,
 * the bug is upstream of fetch (CopilotChat handler not firing). If yes
 * but no matching server log appears, CSP or URL is wrong.
 *
 * Idempotent — multiple bundle loads only wrap once.
 */
function instrumentFetch(): void {
  const w = window as Window & { __copilotkit_fetch_wrapped?: boolean };
  if (w.__copilotkit_fetch_wrapped) return;
  w.__copilotkit_fetch_wrapped = true;
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    // eslint-disable-next-line no-console
    console.log(`[playground-fetch] -> ${method} ${url}`);
    return original(input as RequestInfo, init).then(
      (res) => {
        // eslint-disable-next-line no-console
        console.log(`[playground-fetch] <- ${res.status} ${method} ${url}`);
        return res;
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.log(
          `[playground-fetch] !! ${method} ${url} threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw err;
      },
    );
  };
}

/**
 * Replaces (or appends) a single `<style id="copilotkit-bundle-css">` element
 * with the CSS chunks the IIFE bundler collected from the user's tree (most
 * notably `@copilotkit/react-core/dist/v2/index.css`, force-imported by the
 * codegen entry). Replacing on every bundle means a re-bundle picks up new
 * styles without leaking the old set into the page.
 */
function injectBundleCss(css: string): void {
  const id = "copilotkit-bundle-css";
  let style = document.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = id;
    document.head.appendChild(style);
  }
  style.textContent = css;
}
