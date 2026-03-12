'use client';

import { useEffect, useState } from "react";
import { v0_8 } from "@a2ui/lit";
import * as UI from "@a2ui/lit/ui";

type Status = "pending" | "success" | "failure";

const TARGET_TAG = "a2ui-root";

export function A2UIStatus() {
  const [status, setStatus] = useState<Status>("pending");

  useEffect(() => {
    try {
      const hasCustomElement =
        typeof customElements !== "undefined" &&
        !!customElements.get(TARGET_TAG);

      const hasExport = typeof UI?.Root === "function";

      if (hasCustomElement && hasExport) {
        setStatus("success");
      } else {
        setStatus("failure");
      }
    } catch {
      setStatus("failure");
    }
  }, []);

  if (status === "pending") {
    return null;
  }

  return status === "success" ? (
    <span aria-live="polite">✅ All set</span>
  ) : (
    <span aria-live="assertive">❌ Failed</span>
  );
}
