import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@copilotkit/react-core/v2/styles.css";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
