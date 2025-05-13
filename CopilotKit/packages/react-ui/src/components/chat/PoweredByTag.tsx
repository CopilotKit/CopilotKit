import React from "react";
import { useDarkMode } from "../../hooks/use-dark-mode";

export function PoweredByTag({ showPoweredBy = true }: { showPoweredBy?: boolean }) {
  const isDark = useDarkMode();

  if (!showPoweredBy) {
    return null;
  }

  const poweredByStyle = {
    visibility: "visible",
    display: "block",
    position: "static",
    textAlign: "center",
    fontSize: "12px",
    padding: "3px 0",
    color: isDark ? "rgb(69, 69, 69)" : "rgb(214, 214, 214)",
  };

  return (
    <div>
      {/*@ts-expect-error -- expecting position not to be a string, but it can be.*/}
      <p className="poweredBy" style={poweredByStyle}>
        Powered by CopilotKit
      </p>
    </div>
  );
}
