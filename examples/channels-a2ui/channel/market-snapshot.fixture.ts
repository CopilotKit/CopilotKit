export const marketSnapshotProps = {
  headline: "Live energy market snapshot",
  summary: "Oil benchmarks moved lower in the latest session.",
  markets: [
    {
      name: "Brent crude",
      price: "$79.42/bbl",
      change: "-0.8%",
      sourceName: "Reuters",
      sourceUrl: "https://www.reuters.com/markets/commodities/",
    },
    {
      name: "WTI crude",
      price: "$75.18/bbl",
      change: "-0.6%",
      sourceName: "CME Group",
      sourceUrl: "https://www.cmegroup.com/markets/energy/crude-oil.html",
    },
    {
      name: "RBOB gasoline",
      price: "$2.31/gal",
      change: "+0.2%",
      sourceName: "CME Group",
      sourceUrl:
        "https://www.cmegroup.com/markets/energy/refined-products/rbob-gasoline.html",
    },
  ],
  whyItMatters: "Energy prices feed into transportation and consumer costs.",
  searchedAt: "2026-08-28T12:00:00Z",
} as const;
