/**
 * Client-side memory of "don't ask again" approvals. Each entry is the
 * stable signature of an approval payload (variant + command_name or path).
 * Stored in localStorage so the preference survives reloads but does not
 * leave the operator's machine.
 */

const STORAGE_KEY = "harness-control-room:approval-allowlist";

export function approvalSignature(
  variant: "patch" | "command",
  target: string | undefined,
): string | null {
  const t = target?.trim();
  if (!t) return null;
  return `${variant}:${t}`;
}

export function loadApprovalAllowlist(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function persistApprovalAllowlist(set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // ignore quota / disabled-storage errors
  }
}

export function rememberApproval(signature: string): void {
  const set = loadApprovalAllowlist();
  set.add(signature);
  persistApprovalAllowlist(set);
}

export function forgetApproval(signature: string): void {
  const set = loadApprovalAllowlist();
  set.delete(signature);
  persistApprovalAllowlist(set);
}

export function clearApprovalAllowlist(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
