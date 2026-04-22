import React from "react";
import * as ReactDOMClient from "react-dom/client";
import { App } from "./App";

const container = document.getElementById("root");
if (container) {
  const root = ReactDOMClient.createRoot(container);
  root.render(<App />);
}
