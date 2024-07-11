export interface CopilotKitVersion {
  current: string;
  latest: string;
  severity: "low" | "medium" | "high";
  advisory: string | null;
  lastChecked: number;
}
