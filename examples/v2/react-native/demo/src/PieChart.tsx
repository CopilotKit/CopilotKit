import React from "react";
import { StyleSheet, Text, View } from "react-native";

const CHART_COLORS = [
  "#BEC2FF",
  "#85ECCE",
  "#FFAC4D",
  "#FFF388",
  "#189370",
  "#EEE6FE",
  "#FA5F67",
];

interface PieChartData {
  label: string;
  value: number;
}

interface PieChartProps {
  title: string;
  description: string;
  data: PieChartData[];
  theme: { card: string; text: string; muted: string };
}

export function PieChart({ title, description, data, theme }: PieChartProps) {
  if (!data || data.length === 0) {
    return (
      <View style={[chartStyles.card, { backgroundColor: theme.card }]}>
        <Text style={[chartStyles.title, { color: theme.text }]}>{title}</Text>
        <Text style={[chartStyles.description, { color: theme.muted }]}>
          {description}
        </Text>
        <Text style={[chartStyles.noData, { color: theme.muted }]}>
          No data available
        </Text>
      </View>
    );
  }

  const total = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

  return (
    <View style={[chartStyles.card, { backgroundColor: theme.card }]}>
      <Text style={[chartStyles.title, { color: theme.text }]}>{title}</Text>
      <Text style={[chartStyles.description, { color: theme.muted }]}>
        {description}
      </Text>

      <View style={chartStyles.barContainer}>
        {data.map((item, i) => {
          const pct = total > 0 ? (item.value / total) * 100 : 0;
          if (pct <= 0) return null;
          return (
            <View
              key={i}
              style={[
                chartStyles.barSegment,
                {
                  flex: pct,
                  backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                },
                i === 0 && chartStyles.barFirst,
                i === data.length - 1 && chartStyles.barLast,
              ]}
            />
          );
        })}
      </View>

      <View style={chartStyles.legend}>
        {data.map((item, i) => {
          const val = Number(item.value) || 0;
          const pct = total > 0 ? ((val / total) * 100).toFixed(0) : "0";
          return (
            <View key={i} style={chartStyles.legendRow}>
              <View
                style={[
                  chartStyles.legendDot,
                  { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] },
                ]}
              />
              <Text
                style={[chartStyles.legendLabel, { color: theme.text }]}
                numberOfLines={1}
              >
                {item.label}
              </Text>
              <Text style={[chartStyles.legendValue, { color: theme.muted }]}>
                {val.toLocaleString()}
              </Text>
              <Text style={[chartStyles.legendPct, { color: theme.muted }]}>
                {pct}%
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  title: { fontSize: 17, fontWeight: "700" },
  description: { fontSize: 13, marginTop: 2, marginBottom: 16 },
  noData: { fontSize: 14, textAlign: "center", paddingVertical: 24 },
  barContainer: {
    flexDirection: "row",
    height: 28,
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 16,
  },
  barSegment: { height: "100%" },
  barFirst: { borderTopLeftRadius: 14, borderBottomLeftRadius: 14 },
  barLast: { borderTopRightRadius: 14, borderBottomRightRadius: 14 },
  legend: { gap: 10 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendLabel: { flex: 1, fontSize: 14 },
  legendValue: { fontSize: 14, fontVariant: ["tabular-nums"] },
  legendPct: {
    width: 40,
    fontSize: 13,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
});
