import { useEffect } from "react";

export function useAddBrandingCss(
  suggestionStyleAugmented: React.CSSProperties,
  disableBranding: boolean | undefined
) {
  useEffect(() => {
    if (disableBranding) {
      return;
    }

    const styleEl = document.createElement("style");
    styleEl.id = "dynamic-styles";

    // Build the CSS string dynamically
    let dynamicStyles = Object.entries(suggestionStyleAugmented)
      .map(([key, value]) => {
        const kebabCaseKey = key
          .replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, "$1-$2")
          .toLowerCase();
        return `${kebabCaseKey}: ${value};`;
      })
      .join(" ");

    // Append overrides for italics and font-size
    dynamicStyles += `font-style: normal; font-size: x-small;`;
    dynamicStyles += `content: "CopilotKit";`;

    // Append it to the ::after class
    styleEl.innerHTML = `
      .copilot-textarea.with-branding::after {
        ${dynamicStyles}
      }
    `;

    document.head.appendChild(styleEl);

    // Cleanup
    return () => {
      document.getElementById("dynamic-styles")?.remove();
    };
  }, [disableBranding, suggestionStyleAugmented]);
}
