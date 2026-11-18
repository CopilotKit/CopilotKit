import type { OpenGenerativeUIContent } from "../src/components/OpenGenerativeUIRenderer";
import React from "react";
import { createRoot } from "react-dom/client";
import { OpenGenerativeUIActivityRenderer } from "../src/components/OpenGenerativeUIRenderer";

const root = createRoot(document.getElementById("root")!);
Object.assign(window, {
  renderContent(content: OpenGenerativeUIContent, key = "fixture") {
    root.render(
      <OpenGenerativeUIActivityRenderer
        key={key}
        activityType="open-generative-ui"
        content={content}
        message={{}}
        agent={{}}
      />,
    );
  },
});
