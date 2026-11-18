import React from "react";
import {
  STANDARD_CSS,
  STANDARD_STYLE_ID,
} from "@copilotkit/shared/generative-ui";

// There is no document on the server, so nothing is added there.
const noEffect: typeof React.useInsertionEffect = () => {};
const useInjectEffect =
  typeof document === "undefined" ? noEffect : React.useInsertionEffect;

/**
 * Adds the standard stylesheet to the document once. Every standard
 * component calls it, so a host does not have to import a CSS file.
 */
export function useStandardStyles() {
  useInjectEffect(() => {
    if (document.getElementById(STANDARD_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STANDARD_STYLE_ID;
    style.textContent = STANDARD_CSS;
    document.head.appendChild(style);
  }, []);
}
