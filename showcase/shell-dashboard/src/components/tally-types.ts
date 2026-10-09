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
  /**
   * True when the feed is mid-reconnect (`connecting`) but rows ALREADY exist
   * (size>0): the counts are authoritative (real, NOT loading zeros) yet may
   * be behind the live state. Distinct from `loading` (initial fetch, no rows)
   * and `unknown` (offline) — the header renders the counts in a muted
   * treatment instead of hiding them. Mutually exclusive with `loading`:
   * `loading` is the no-rows window, `stale` is the rows-present window.
   */
  stale: boolean;
}
