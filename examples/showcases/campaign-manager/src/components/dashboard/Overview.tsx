"use client";

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

// Work around React deprecation warning
const XAxisDefaultProps = XAxis.defaultProps;
const YAxisDefaultProps = YAxis.defaultProps;
delete XAxis.defaultProps;
delete YAxis.defaultProps;

const MAX_VALUE = 10000;
const MIN_VALUE = 1000;

const data = [
  {
    name: "Jan",
    total: Math.floor(Math.random() * MAX_VALUE) + MIN_VALUE,
  },
  {
    name: "Feb",
    total: Math.floor(Math.random() * MAX_VALUE) + MIN_VALUE,
  },
  {
    name: "Mar",
    total: Math.floor(Math.random() * MAX_VALUE) + MIN_VALUE,
  },
  {
    name: "Apr",
    total: Math.floor(Math.random() * MAX_VALUE) + MIN_VALUE,
  },
  {
    name: "May",
    total: Math.floor(Math.random() * MAX_VALUE) + MIN_VALUE,
  },
  {
    name: "Jun",
    total: Math.floor(Math.random() * MAX_VALUE) + MIN_VALUE,
  },
  {
    name: "Jul",
    total: Math.floor(Math.random() * MAX_VALUE) + MIN_VALUE,
  },
  {
    name: "Aug",
    total: Math.floor(Math.random() * MAX_VALUE) + MIN_VALUE,
  },
  {
    name: "Sep",
    total: Math.floor(Math.random() * MAX_VALUE) + MIN_VALUE,
  },
  {
    name: "Oct",
    total: Math.floor(Math.random() * MAX_VALUE) + MIN_VALUE,
  },
  {
    name: "Nov",
    total: Math.floor(Math.random() * MAX_VALUE) + MIN_VALUE,
  },
  {
    name: "Dec",
    total: Math.floor(Math.random() * MAX_VALUE) + MIN_VALUE,
  },
];

export function Overview() {
  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart data={data}>
        <XAxis
          {...XAxisDefaultProps}
          dataKey="name"
          stroke="#888888"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          {...YAxisDefaultProps}
          stroke="#888888"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: any) => `$${value}`}
        />
        <Bar
          dataKey="total"
          fill="currentColor"
          radius={[4, 4, 0, 0]}
          className="fill-primary"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
