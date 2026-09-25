import { resolve } from "node:path";

export function evidencePath(iteration: string, ...parts: string[]): string {
  const root =
    process.env.AUTOPILOT_EVIDENCE_ROOT ??
    resolve(process.cwd(), "../../../.context/autopilot-evidence");
  return resolve(root, iteration, ...parts);
}
