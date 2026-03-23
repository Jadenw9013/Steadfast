"use client";

import { ResponsiveContainer, LineChart, Line, Dot } from "recharts";

type Point = { date: string; weight: number };

export function WeightTrendChart({ data }: { data: Point[] }) {
  if (data.length < 2) return null;

  const current = data[data.length - 1].weight;
  const prev = data[data.length - 2].weight;
  const delta = +(current - prev).toFixed(1);

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#0d1829] p-4">
      {/* Top row */}
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-xl font-bold tabular-nums text-zinc-100 sm:text-2xl">
            {current}
          </span>
          <span className="text-sm text-zinc-500">lbs</span>
        </div>
        {delta === 0 ? (
          <span className="text-sm text-zinc-500">No change</span>
        ) : delta < 0 ? (
          <span className="flex items-center gap-1 text-sm text-emerald-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 5 0 14"/><path d="m19 12-7 7-7-7"/></svg>
            {Math.abs(delta)} lbs
          </span>
        ) : (
          <span className="flex items-center gap-1 text-sm text-red-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 19 0-14"/><path d="m5 12 7-7 7 7"/></svg>
            {delta} lbs
          </span>
        )}
      </div>

      {/* Chart */}
      <div className="mt-3 h-[100px]" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
            <Line
              type="monotone"
              dataKey="weight"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={(props) => {
                // Only render dot on the last point
                const { index, cx, cy } = props as { index: number; cx: number; cy: number };
                if (index !== data.length - 1) return <g key={index} />;
                return <Dot key={index} cx={cx} cy={cy} r={4} fill="#3b82f6" stroke="none" />;
              }}
              activeDot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Footer */}
      <p className="mt-1 text-xs text-zinc-600">{data.length} check-ins tracked</p>
    </div>
  );
}
