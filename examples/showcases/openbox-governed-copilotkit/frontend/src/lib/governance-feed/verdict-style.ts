import {
  CircleCheck,
  CircleX,
  OctagonX,
  ShieldAlert,
  ShieldQuestion,
  Circle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { GovernanceVerdict } from "./types";

export interface VerdictStyle {
  /** Human label shown in the badge (matches e2e regexes where relevant). */
  label: string;
  icon: LucideIcon;
  /** Utility classes for the badge container. */
  badgeClass: string;
}

/**
 * Verdict -> presentation. Labels intentionally match the terminal-verdict
 * regex used by the e2e suite: Allowed | Redacted | Constrained | Blocked |
 * Halted | Rejected. "Reviewing" is the pre-decision state.
 */
export const VERDICT_STYLE: Record<GovernanceVerdict, VerdictStyle> = {
  reviewing: {
    label: "Reviewing",
    icon: Circle,
    badgeClass: "openbox-feed-badge openbox-feed-badge--reviewing",
  },
  allow: {
    label: "Allowed",
    icon: CircleCheck,
    badgeClass: "openbox-feed-badge openbox-feed-badge--allow",
  },
  constrain: {
    label: "Constrained",
    icon: ShieldAlert,
    badgeClass: "openbox-feed-badge openbox-feed-badge--constrain",
  },
  approval: {
    label: "Approval",
    icon: ShieldQuestion,
    badgeClass: "openbox-feed-badge openbox-feed-badge--approval",
  },
  block: {
    label: "Blocked",
    icon: CircleX,
    badgeClass: "openbox-feed-badge openbox-feed-badge--block",
  },
  halt: {
    label: "Halted",
    icon: OctagonX,
    badgeClass: "openbox-feed-badge openbox-feed-badge--halt",
  },
  rejected: {
    label: "Rejected",
    icon: CircleX,
    badgeClass: "openbox-feed-badge openbox-feed-badge--block",
  },
  error: {
    label: "Error",
    icon: OctagonX,
    badgeClass: "openbox-feed-badge openbox-feed-badge--halt",
  },
};
