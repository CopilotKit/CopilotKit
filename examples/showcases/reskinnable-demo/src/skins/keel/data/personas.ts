import type { Persona } from "./types";

/**
 * The four switchable demo personas. `role` is the value matched against a
 * step's `approverRole` to decide whether an approval gate is actionable.
 *
 * Note: the `vendor-baa-review` playbook's `legal-sign` gate requires
 * "Legal Counsel", which is deliberately NOT a persona here — it demonstrates
 * the "waiting on someone else" state (spec §6.2).
 */
export const KEEL_PERSONAS: Persona[] = [
  {
    id: "ana-reyes",
    name: "Ana Reyes",
    role: "Nurse Manager",
    unit: "4 West",
  },
  {
    id: "sam-okafor",
    name: "Sam Okafor",
    role: "Privacy Officer",
    unit: "Privacy Office",
  },
  {
    id: "dr-ellis",
    name: "Dr. Marcus Ellis",
    role: "Chief Medical Officer",
    unit: "Medical Staff",
  },
  {
    id: "lin-whitaker",
    name: "Lin Whitaker",
    role: "Information Security Lead",
    unit: "Information Security",
  },
];

export const DEFAULT_PERSONA_ID = "ana-reyes";

export function getPersona(id: string): Persona {
  return (
    KEEL_PERSONAS.find((p) => p.id === id) ??
    KEEL_PERSONAS.find((p) => p.id === DEFAULT_PERSONA_ID) ??
    KEEL_PERSONAS[0]
  );
}
