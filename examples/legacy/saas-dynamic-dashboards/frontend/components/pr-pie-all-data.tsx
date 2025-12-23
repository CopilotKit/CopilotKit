import { Cell } from "recharts";
import { useEffect, useState } from "react";
import { Pie, PieChart, Tooltip } from "recharts";

interface PieDataItem {
    name: string;
    value: number;
    color: string;
    shortName: string;
}


interface PieDataProps {
    args: {
        items: PieDataItem[];
        title?: string;
    };
}

export function PRPieData({ args }: PieDataProps) {
    const [chartData, setChartData] = useState<PieDataItem[]>([]);
    useEffect(() => {
        console.log(JSON.stringify(args), "argsarhs");

        if (args?.items) {
            debugger
            setChartData(args?.items);
        }
    }, [args?.items]);

    return (
        <div className="flex-1 p-4 rounded-2xl shadow-lg flex flex-col items-center min-w-[250px] max-w-[350px]">
            <h2 className="text-xl font-semibold mb-2 text-gray-700 text-center">
                {args.title || "Data Distribution"}
            </h2>
            <div className="h-[180px] flex flex-col items-center justify-center">
                <PieChart width={260} height={180}>
                    <Pie
                        data={chartData}
                        cx={130}
                        cy={90}
                        innerRadius={30}
                        outerRadius={70}
                        paddingAngle={0}
                        dataKey="value"
                        labelLine={false}
                        label={({ value }) => value}
                    >
                        {chartData.map((entry, index: number) => (
                            <Cell
                                key={`cell-${index}`}
                                fill={chartData[index].color}
                            />
                        ))}
                    </Pie>
                    <Tooltip content={<CustomPieTooltip />} />
                </PieChart>
            </div>
            <div className="flex flex-col items-center mt-4">
                {chunkArray(chartData, 2).map((row, rowIdx) => (
                    <div
                        key={rowIdx}
                        className="flex flex-row justify-center items-center gap-x-6 gap-y-2 w-full"
                    >
                        {row.map((entry: PieDataItem) => (
                            <div key={entry.name} className="flex items-center gap-1 min-w-[110px]">
                                <span style={{ backgroundColor: entry.color }}
                                    className={`inline-block w-4 h-4 rounded-full`}
                                />
                                <span style={{ width: "94px" }} className="text-sm text-black">{entry?.shortName}</span>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    )
}

export const CustomPieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
        const { name, value } = payload[0].payload;
        return (
            <div className="bg-white p-2 rounded shadow text-black">
                <div>{name.split("_").join(" ")}</div>
                <div>Value: {value}</div>
            </div>
        );
    }
    return null;
};

export function chunkArray<T>(array: T[], size: number): T[][] {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}
