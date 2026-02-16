import { PRData } from "@/app/Interfaces/interface";
import { useSharedContext } from "@/lib/shared-context";
import { useEffect, useState } from "react";
import { Legend } from "recharts";
import { CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { Bar } from "recharts";
import { BarChart } from "recharts";

interface BarChartData {
  name: string;
  value: number;
}

export function PRReviewBarData({ args }: any) {
  const [data, setData] = useState<BarChartData[]>([]);
  const chartColors = [
    "hsl(12, 76%, 61%)",
    "hsl(173, 58%, 39%)",
    "hsl(197, 37%, 24%)",
    "hsl(43, 74%, 66%)",
    "hsl(27, 87%, 67%)",
  ];

  useEffect(() => {
    debugger;
    console.log(args);
    if (args?.items) {
      setData(args?.items);
    }
  }, [args?.items]);

  function getUniqueReviewers(prArray: PRData[]): string[] {
    const reviewerSet = new Set<string>();
    for (const pr of prArray) {
      if (pr.assignedReviewer) {
        reviewerSet.add(pr.assignedReviewer.toLowerCase()); // normalize casing if needed
      }
    }
    return Array.from(reviewerSet);
  }

  return (
    <>
      {/* Bar Chart Section */}
      <div className="flex min-w-[250px] max-w-[350px] flex-1 flex-col items-center rounded-2xl p-4 shadow-lg">
        <h2 className="mb-2 text-center text-xl font-semibold text-gray-700">
          Data Distribution
        </h2>
        <div className="flex h-[180px] items-center justify-center">
          <BarChart width={260} height={180} data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#94a3b855" />
            <XAxis
              dataKey="name"
              stroke="#cbd5e1"
              className="text-black"
              tickFormatter={(value: string) => value[0]?.toUpperCase()}
            />
            <YAxis stroke="#cbd5e1" />
            <Tooltip
              contentStyle={{
                background: "#1f2937",
                border: "none",
                color: "white",
              }}
            />
            <Legend wrapperStyle={{ color: "white" }} />
            <Bar dataKey="value" fill={chartColors[3]} />
            {/* <Bar dataKey="merged" fill="#475569" /> */}
            {/* <Bar dataKey="closed" fill="#cbd5e1" /> */}
          </BarChart>
        </div>
      </div>
    </>
  );
}
