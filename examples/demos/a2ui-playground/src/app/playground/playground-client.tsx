"use client";

import { Providers } from "@/components/app/providers";
import { Workbench } from "@/components/playground/workbench";
import { DesignSystemProvider } from "@/design-systems/context";

export function PlaygroundClient({ embed = false }: { embed?: boolean }) {
  return (
    <DesignSystemProvider>
      <Providers>
        <Workbench embed={embed} />
      </Providers>
    </DesignSystemProvider>
  );
}
