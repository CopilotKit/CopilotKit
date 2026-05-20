export interface TallyItem {
  label: string;
  dimension: "health" | "e2e";
  featureId?: string;
}

export interface TallyDetail {
  green: TallyItem[];
  amber: TallyItem[];
  red: TallyItem[];
  unknown: boolean;
}
