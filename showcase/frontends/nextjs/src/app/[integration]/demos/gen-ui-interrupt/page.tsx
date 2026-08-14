import {
  getIntegration,
  resolveInterruptPattern,
} from "@/lib/integration-support";
import { GenUiInterruptChat } from "./chat";

export const dynamic = "force-dynamic";

/**
 * Server wrapper: pick the interrupt hook from `interrupt_pattern`.
 *
 * This page is one file for every slug. `native` (and a missing field)
 * keeps `useInterrupt`. `promise-based` registers `useHumanInTheLoop`
 * for `schedule_meeting`. The field lives on the manifest; do not branch
 * on the slug here.
 */
export default async function GenUiInterruptDemo({
  params,
}: {
  params: Promise<{ integration: string }>;
}) {
  const { integration } = await params;
  const interruptPattern = resolveInterruptPattern(getIntegration(integration));
  return (
    <GenUiInterruptChat
      integration={integration}
      interruptPattern={interruptPattern}
    />
  );
}
