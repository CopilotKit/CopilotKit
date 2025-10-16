import React, { useState, useEffect } from "react";
import { useDarkMode } from "../../hooks/use-dark-mode";

export function PoweredByTag({ showPoweredBy = true }: { showPoweredBy?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const isDark = useDarkMode();

  /*
    note(tylerslaton):

    Ensure we only use the isDark computed value after client-side mount.
    This prevents hydration mismatches by using a default color on the
    server and initial client render, then updating to the correct
    dark mode color after hydration is complete.
  */
  useEffect(() => {
    setMounted(true);
  }, []);

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
    color: mounted && isDark ? "rgb(69, 69, 69)" : "rgb(214, 214, 214)",
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
