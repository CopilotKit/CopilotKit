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
  /**
   * True only during the initial-load window (connecting + no rows yet). A
   * subset of `unknown` — distinguishes "data still loading" from "dashboard
   * offline" so the header can show a loading affordance instead of zeros.
   */
  loading: boolean;
}
