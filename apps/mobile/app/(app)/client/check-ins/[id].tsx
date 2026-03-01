import React, { useCallback, useState } from "react";
import { ScrollView, View, Text, StyleSheet, Image } from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiGet } from "@/lib/api";
import { useThemeColors, spacing, fontSize } from "@/lib/theme";
import { Header } from "@/components/ui/Header";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import type { CheckInDetail } from "@/lib/types";

export default function CheckInDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const c = useThemeColors();
    const [checkIn, setCheckIn] = useState<CheckInDetail | null>(null);
    const [loading, setLoading] = useState(true);

    useFocusEffect(
        useCallback(() => {
            (async () => {
                try {
                    const res = await apiGet<{ checkIn: CheckInDetail }>(`/api/mobile/check-ins/${id}`);
                    setCheckIn(res.checkIn);
                } catch {
                    // handle
                } finally {
                    setLoading(false);
                }
            })();
        }, [id])
    );

    if (loading || !checkIn) return <LoadingScreen />;

    const dateLabel = new Date(checkIn.submittedAt).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });

    return (
        <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
            <ScrollView contentContainerStyle={styles.scroll}>
                <Header
                    title="Check-In Detail"
                    subtitle={dateLabel}
                    right={
                        <Badge
                            label={checkIn.status === "REVIEWED" ? "Reviewed" : "Pending"}
                            variant={checkIn.status === "REVIEWED" ? "success" : "warning"}
                        />
                    }
                />

                <Card style={{ marginBottom: spacing.md }}>
                    <View style={styles.statRow}>
                        <StatItem label="Weight" value={checkIn.weight != null ? `${checkIn.weight} lbs` : "—"} color={c} />
                        <StatItem label="Diet" value={checkIn.dietCompliance != null ? `${checkIn.dietCompliance}/10` : "—"} color={c} />
                        <StatItem label="Energy" value={checkIn.energyLevel != null ? `${checkIn.energyLevel}/10` : "—"} color={c} />
                    </View>
                </Card>

                {checkIn.notes && (
                    <Card style={{ marginBottom: spacing.md }}>
                        <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Notes</Text>
                        <Text style={[styles.notesText, { color: c.foreground }]}>{checkIn.notes}</Text>
                    </Card>
                )}

                {checkIn.photos.length > 0 && (
                    <Card style={{ marginBottom: spacing.md }}>
                        <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Photos</Text>
                        <View style={styles.photoGrid}>
                            {checkIn.photos.map((p) => (
                                <Image key={p.id} source={{ uri: p.url }} style={styles.photo} resizeMode="cover" />
                            ))}
                        </View>
                    </Card>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

function StatItem({ label, value, color }: { label: string; value: string; color: ReturnType<typeof useThemeColors> }) {
    return (
        <View style={styles.stat}>
            <Text style={[styles.statLabel, { color: color.mutedForeground }]}>{label}</Text>
            <Text style={[styles.statValue, { color: color.foreground }]}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1 },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
    statRow: { flexDirection: "row", justifyContent: "space-around" },
    stat: { alignItems: "center" },
    statLabel: { fontSize: fontSize.xs, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
    statValue: { fontSize: fontSize.xl, fontWeight: "700" },
    sectionLabel: { fontSize: fontSize.xs, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing.sm },
    notesText: { fontSize: fontSize.sm, lineHeight: 20 },
    photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    photo: { width: 100, height: 100, borderRadius: 12 },
});
