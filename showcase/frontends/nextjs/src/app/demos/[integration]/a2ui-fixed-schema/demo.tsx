"use client";

/**
 * Declarative Generative UI demo, A2UI fixed schema.
 *
 * In the fixed-schema flavor of A2UI, the component tree is authored ahead of
 * time and the agent only streams data into the data model. The flight card
 * is assembled from small components (Card > Column > [Title, Row, ...]).
 *
 * - Definitions (Zod schemas): `./a2ui/definitions.ts`
 * - Renderers (React): `./a2ui/renderers.tsx`
 * - Catalog wiring: `./a2ui/catalog.ts` (includes the basic catalog)
 *
 * Reference:
 * https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui/fixed-schema
 */
import { CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";

import { A2UIFormatFrame } from "../_shared/a2ui-format-frame";
import { catalog } from "./a2ui/catalog";
import { Chat } from "./chat";
import type { A2uiFixedSchemaConfig } from "./config";

export function A2uiFixedSchemaDemo({
  config,
}: {
  config: A2uiFixedSchemaConfig;
}) {
  const runtimeUrl = useDemoRuntimeUrl("a2ui-fixed-schema");
  return (
    <A2UIFormatFrame selector={config.formatSelector}>
      {(properties) => (
        // `a2ui.catalog` wires the fixed catalog into the A2UI activity
        // renderer.
        <CopilotKit
          runtimeUrl={runtimeUrl}
          agent="a2ui-fixed-schema"
          a2ui={{ catalog }}
          properties={properties}
        >
          <div className="flex justify-center items-center h-full w-full bg-neutral-50 dark:bg-background">
            <div className="h-full w-full max-w-4xl border-x border-neutral-200 bg-white dark:border-border dark:bg-background">
              <Chat />
            </div>
          </div>
        </CopilotKit>
      )}
    </A2UIFormatFrame>
  );
}
