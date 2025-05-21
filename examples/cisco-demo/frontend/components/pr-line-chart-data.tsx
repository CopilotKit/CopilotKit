import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { useSharedContext } from "@/lib/shared-context";
import { PRData, WeeklyCount } from "@/app/Interfaces/interface";

export function PRLineChartData({ args }: any) {
    const { prData } = useSharedContext()
    const [lineData, setLineData] = useState<WeeklyCount[]>([])
    useEffect(() => {
        console.log(args);
        
        if(args?.data) {
            setLineData(args.data)
        }
    }, [args])

    function groupPRsByWeek(prs: PRData[]): WeeklyCount[] {
        const weekMap: Record<string, number> = {};
      
        prs.forEach(pr => {
          const date = new Date(pr.createdAt);
          const day = date.getUTCDay(); // 0 (Sun) to 6 (Sat)
          const diffToMonday = (day + 6) % 7; // get difference to previous Monday
          const monday = new Date(date);
          monday.setUTCDate(date.getUTCDate() - diffToMonday);
          monday.setUTCHours(0, 0, 0, 0); // normalize to midnight
      
          const mondayStr = monday.toISOString().split('T')[0];
      
          weekMap[mondayStr] = (weekMap[mondayStr] || 0) + 1;
        });
      
        return Object.entries(weekMap)
          .map(([week, count]) => ({ week, count }))
          .sort((a, b) => a.week.localeCompare(b.week));
      }

    return (
        <div className="p-4 rounded-2xl shadow-lg flex flex-col items-center w-full min-w-[250px] max-w-full">
            <h2 className="text-xl font-semibold mb-2 text-gray-700 text-center">Weekly PR Trends</h2>
            <div className="h-[200px] w-full flex items-center justify-center">
                <LineChart width={520} height={220} data={lineData}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#B6C7DB" />
                    <XAxis dataKey="name" stroke="#4F5A66" />
                    <YAxis stroke="#4F5A66" />
                    {/* <Tooltip content={<CustomPieTooltip />} /> */}
                    <Legend
                        verticalAlign="bottom"
                        // height={36}
                        width={225}
                        align="center"
                        wrapperStyle={{ color: 'black', fontSize: '12px', paddingLeft: 10 }}
                    />
                    <Line type="monotone" dataKey="value" stroke="rgb(134 239 172)" strokeWidth={4} dot={{ r: 8, strokeWidth: 2 }} />
                    {/* <Line type="monotone" dataKey="merged" stroke="#475569" strokeWidth={3} dot={{ r: 5 }} /> */}
                    {/* <Line type="monotone" dataKey="closed" stroke="#B6C7DB" strokeWidth={3} dot={{ r: 5 }} /> */}
                </LineChart>
            </div>
        </div>
    )
}

const CustomPieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
        debugger
        const { week, count } = payload[0].payload;
        return (
            <div className="bg-white p-2 rounded shadow text-black">
                {`${week} - ${count}`}
            </div>
        );
    }
    return null;
};