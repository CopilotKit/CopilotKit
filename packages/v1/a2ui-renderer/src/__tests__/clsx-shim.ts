/**
 * Minimal clsx shim for Vitest so "clsx" resolves when pnpm has not linked it
 * in the package's node_modules. Only used in test config alias.
 */
export type ClassValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Record<string, unknown>
  | ClassValue[];

function clsx(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const x of inputs) {
    if (x == null || typeof x === "boolean") continue;
    if (typeof x === "string" || typeof x === "number") {
      out.push(String(x));
      continue;
    }
    if (Array.isArray(x)) {
      out.push(clsx(...x));
      continue;
    }
    if (typeof x === "object") {
      for (const [k, v] of Object.entries(x)) {
        if (v) out.push(k);
      }
    }
  }
  return out.filter(Boolean).join(" ");
}

export { clsx };
