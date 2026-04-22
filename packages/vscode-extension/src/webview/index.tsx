import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";
import * as A2UIRenderer from "@copilotkit/a2ui-renderer";
import { App } from "./App";

// Expose shared dependencies as globals so IIFE-bundled catalog code
// uses the same instances (critical for React hooks to work).
(window as any).__copilotkit_deps = {
  React,
  ReactDOM,
  ReactDOMClient,
  JSXRuntime,
  A2UIRenderer,
};

const container = document.getElementById("root");
if (container) {
  const root = ReactDOMClient.createRoot(container);
  root.render(<App />);
}
