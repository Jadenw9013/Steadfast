import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Polyline, Circle, Line, Text as SvgText } from "react-native-svg";
import { useThemeColors, spacing, fontSize, radius } from "@/lib/theme";

interface DataPoint {
    date: string;
    weight: number;
}

interface WeightChartProps {
    data: DataPoint[];
    height?: number;
}

export function WeightChart({ data, height = 160 }: WeightChartProps) {
    const c = useThemeColors();

    if (data.length < 2) {
        return (
            <View style={[styles.empty, { height }]}>
                <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
                    Not enough data for chart
                </Text>
            </View>
        );
    }

    const sorted = [...data].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const weights = sorted.map((d) => d.weight);
    const minW = Math.min(...weights);
    const maxW = Math.max(...weights);
    const range = maxW - minW || 1;

    const padding = { top: 20, bottom: 30, left: 8, right: 8 };
    const chartWidth = 320;
    const chartHeight = height;
    const plotW = chartWidth - padding.left - padding.right;
    const plotH = chartHeight - padding.top - padding.bottom;

    const points = sorted.map((d, i) => ({
        x: padding.left + (i / (sorted.length - 1)) * plotW,
        y: padding.top + plotH - ((d.weight - minW) / range) * plotH,
        weight: d.weight,
        date: d.date,
    }));

    const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

    // Show a few Y-axis labels
    const midW = +((minW + maxW) / 2).toFixed(1);

    // X-axis: first and last date labels
    const firstLabel = new Date(sorted[0].date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
    });
    const lastLabel = new Date(sorted[sorted.length - 1].date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
    });

    return (
        <View style={styles.container}>
            <Svg width={chartWidth} height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
                {/* Grid lines */}
                <Line
                    x1={padding.left}
                    y1={padding.top}
                    x2={chartWidth - padding.right}
                    y2={padding.top}
                    stroke={c.border}
                    strokeWidth={0.5}
                    strokeDasharray="4,4"
                />
                <Line
                    x1={padding.left}
                    y1={padding.top + plotH / 2}
                    x2={chartWidth - padding.right}
                    y2={padding.top + plotH / 2}
                    stroke={c.border}
                    strokeWidth={0.5}
                    strokeDasharray="4,4"
                />
                <Line
                    x1={padding.left}
                    y1={padding.top + plotH}
                    x2={chartWidth - padding.right}
                    y2={padding.top + plotH}
                    stroke={c.border}
                    strokeWidth={0.5}
                />

                {/* Line */}
                <Polyline
                    points={polylinePoints}
                    fill="none"
                    stroke={c.primary}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />

                {/* Data points */}
                {points.map((p, i) => (
                    <Circle key={i} cx={p.x} cy={p.y} r={3} fill={c.primary} />
                ))}

                {/* Y-axis labels */}
                <SvgText x={padding.left + 2} y={padding.top - 6} fontSize={9} fill={c.mutedForeground}>
                    {maxW}
                </SvgText>
                <SvgText
                    x={padding.left + 2}
                    y={padding.top + plotH / 2 - 4}
                    fontSize={9}
                    fill={c.mutedForeground}
                >
                    {midW}
                </SvgText>
                <SvgText
                    x={padding.left + 2}
                    y={padding.top + plotH - 4}
                    fontSize={9}
                    fill={c.mutedForeground}
                >
                    {minW}
                </SvgText>

                {/* X-axis labels */}
                <SvgText x={padding.left} y={chartHeight - 6} fontSize={9} fill={c.mutedForeground}>
                    {firstLabel}
                </SvgText>
                <SvgText
                    x={chartWidth - padding.right}
                    y={chartHeight - 6}
                    fontSize={9}
                    fill={c.mutedForeground}
                    textAnchor="end"
                >
                    {lastLabel}
                </SvgText>
            </Svg>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { alignItems: "center" },
    empty: { justifyContent: "center", alignItems: "center" },
    emptyText: { fontSize: fontSize.sm },
});
