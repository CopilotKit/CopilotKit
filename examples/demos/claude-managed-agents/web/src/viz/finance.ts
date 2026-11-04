/** Pure client-side finance math backing the interactive growth projection. */

export interface GrowthPoint {
  year: number;
  contributed: number;
  value: number;
}

export function growthSchedule(
  initialAmount: number,
  monthlyContribution: number,
  annualReturnPercent: number,
  years: number,
): GrowthPoint[] {
  const rate = annualReturnPercent / 100 / 12;
  const points: GrowthPoint[] = [
    { year: 0, contributed: initialAmount, value: initialAmount },
  ];
  let value = initialAmount;
  let contributed = initialAmount;
  const horizon = Math.min(Math.max(1, Math.round(years)), 50);

  for (let month = 1; month <= horizon * 12; month++) {
    value = value * (1 + rate) + monthlyContribution;
    contributed += monthlyContribution;
    if (month % 12 === 0) {
      points.push({ year: month / 12, contributed, value });
    }
  }
  return points;
}
