"use client";

import React from "react";

export function CustomDisclaimer(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      data-testid="custom-disclaimer"
      className="text-xs text-center text-muted-foreground py-2"
    >
      <span className="inline-block rounded bg-indigo-100 text-indigo-700 px-2 py-0.5 mr-2 font-semibold">
        slot
      </span>
      Custom disclaimer injected via <code>input.disclaimer</code>.
    </div>
  );
}
