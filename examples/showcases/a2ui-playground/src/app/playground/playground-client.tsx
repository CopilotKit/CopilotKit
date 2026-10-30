"use client";

import { Providers } from "@/components/app/providers";
import { Workbench } from "@/components/playground/workbench";

export function PlaygroundClient() {
  return (
    <Providers>
      <Workbench />
    </Providers>
  );
}
