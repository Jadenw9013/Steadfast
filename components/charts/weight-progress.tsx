"use client";

import { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

type WeightDataPoint = { date: string; weight: number };
type Range = "30d" | "90d" | "all";

export function WeightProgress({
  data,
  clientId,
  className,
}: {
  data: WeightDataPoint[];
  clientId: string;
  className?: string;
}) {
  const [range, setRange] = useState<Range>("all");
  const [chartData, setChartData] = useState(data);
  const [loading, setLoading] = useState(false);

  async function handleRangeChange(newRange: Range) {
    if (newRange === range) return;
    setRange(newRange);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/weight-history?range=${newRange}`
      );
      if (res.ok) {
        setChartData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }

  if (chartData.length < 2) {
    return (
      <div className={className}>
        <p className="text-sm text-zinc-400">
          Not enough data to display a chart. Submit at least 2 check-ins with
          weight.
        </p>
      </div>
    );
  }

  const weights = chartData.map((d) => d.weight);
  const minW = Math.floor(Math.min(...weights) - 1);
  const maxW = Math.ceil(Math.max(...weights) + 1);

  const ranges: { key: Range; label: string }[] = [
    { key: "30d", label: "30d" },
    { key: "90d", label: "90d" },
    { key: "all", label: "All" },
  ];

  return (
    <div className={className} role="img" aria-label="Weight progress chart">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Weight Progress
        </p>
        <div className="flex gap-1">
          {ranges.map((r) => (
            <button
              key={r.key}
              onClick={() => handleRangeChange(r.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                range === r.key
                  ? "bg-zinc-900 text-white dark:bg-blue-600 dark:text-white"
                  : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className={`h-48 ${loading ? "opacity-50" : ""}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 5, left: -10, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#a1a1aa" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[minW, maxW]}
              tick={{ fontSize: 11, fill: "#a1a1aa" }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#18181b",
                border: "1px solid #3f3f46",
                borderRadius: "8px",
                fontSize: "13px",
              }}
              labelStyle={{ color: "#a1a1aa" }}
              itemStyle={{ color: "#fafafa" }}
            />
            <Line
              type="monotone"
              dataKey="weight"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#3b82f6" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
