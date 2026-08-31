// Early-access gate registry — shared between server routes (which
// decide WHETHER a page is gated) and the client-side
// `EarlyAccessGate` component (which renders the unlock UI).
//
// This is a soft gate: the password lives in the client bundle and the
// gated content is still server-rendered behind the blur (and remains
// reachable via the raw-MDX / llms.txt routes). It exists to keep
// early-access docs out of casual view, not to be a security boundary.

export interface EarlyAccessGateConfig {
  /** localStorage key remembering that this gate was unlocked. */
  storageKey: string;
  /** Shared access password compared against the visitor's input. */
  password: string;
  /** Small uppercase label above the gate title. */
  eyebrow: string;
  /** Gate card heading. */
  title: string;
  /** Copy explaining the gate and what the gated feature is, one
   *  string per paragraph. */
  description: string[];
  /** Lead-in before the request-access link, e.g. "Don't have the password?" */
  requestPrompt: string;
  /** Link text for the request-access CTA. */
  requestLinkLabel: string;
  /** Where the request-access CTA points (early-access form). */
  requestUrl: string;
  /** Optional product visual shown in the card body, per theme. The
   *  card renders it with `fill`, so no intrinsic dimensions needed. */
  image?: { alt: string; lightSrc: string; darkSrc: string };
}

// No Channels provider currently uses an early-access docs gate. WhatsApp is a
// coming-soon roadmap item, while Slack and Teams are production ready.
export const EARLY_ACCESS_GATES = {} as const satisfies Record<
  string,
  EarlyAccessGateConfig
>;

export function getEarlyAccessGate(
  id: string | undefined,
): EarlyAccessGateConfig | null {
  if (!id) return null;
  return (
    (EARLY_ACCESS_GATES as Record<string, EarlyAccessGateConfig>)[id] ?? null
  );
}
