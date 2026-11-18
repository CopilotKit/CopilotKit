"use client";

/** One persona (Maya Chen, Finance Operations Lead): frozen runtime properties. */
const PROPS: Readonly<Record<string, unknown>> = Object.freeze({
  userId: "u_maya",
  userRole: "finance-ops",
});

export function useLedgerlineRuntimeProperties(): Record<string, unknown> {
  return PROPS;
}
