export interface Campaign {
  id: string;
  objective?:
    | "brand-awareness"
    | "lead-generation"
    | "sales-conversion"
    | "website-traffic"
    | "engagement";
  title: string;
  keywords: string;
  url: string;
  headline: string;
  description: string;
  budget: number;
  bidStrategy?: "manual-cpc" | "cpa" | "cpm";
  bidAmount?: number;
  segment?: string;
}
