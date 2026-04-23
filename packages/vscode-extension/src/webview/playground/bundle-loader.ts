import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";
import { createCopilotkitStubs } from "../hook-preview/copilotkit-stubs";

declare global {
  interface Window {
    __copilotkit_playground?: { PlaygroundEntry: React.ComponentType };
    __copilotkit_deps?: Record<string, unknown>;
  }
}

export interface PlaygroundBundleExports {
  PlaygroundEntry: React.ComponentType;
}

/**
 * Installs deps (React, CopilotKit stubs) on the window, evaluates the IIFE
 * bundle via a nonced script injection, reads the resulting global, and
 * resolves with the entry component. Rejects if the bundle fails to expose
 * __copilotkit_playground.PlaygroundEntry.
 */
export function executePlaygroundBundle(
  code: string,
): Promise<PlaygroundBundleExports> {
  return new Promise((resolve, reject) => {
    try {
      window.__copilotkit_deps = {
        React,
        ReactDOM,
        ReactDOMClient,
        JSXRuntime,
        copilotkitStubs: createCopilotkitStubs(),
      };
    } catch (err) {
      reject(err);
      return;
    }

    try {
      // Execute the bundle code in the current window context. Using
      // new Function keeps the code isolated in its own scope while still
      // having access to globals (window, document) — this works in both
      // jsdom test environments and inside the already-nonce-trusted VS Code
      // webview script context.
      // eslint-disable-next-line no-new-func
      new Function(code)();
    } catch (err) {
      reject(err);
      return;
    }

    const exports = window.__copilotkit_playground;
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
