import React, { useCallback, useState } from "react";
import {
    ScrollView,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    RefreshControl,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiGet } from "@/lib/api";
import { useThemeColors, spacing, fontSize, radius } from "@/lib/theme";
import { Header } from "@/components/ui/Header";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import type { CoachDashboard, CoachClient } from "@/lib/types";

function KpiCard({
    value,
    label,
    accentColor,
    colors: c,
}: {
    value: number;
    label: string;
    accentColor: string;
    colors: ReturnType<typeof useThemeColors>;
}) {
    return (
        <View
            style={[
                kpiStyles.card,
                {
                    backgroundColor: c.card,
                    borderColor: c.borderLight,
                    borderLeftColor: accentColor,
                    borderLeftWidth: 3,
                },
            ]}
        >
            <Text style={[kpiStyles.value, { color: c.foreground }]}>{value}</Text>
            <Text style={[kpiStyles.label, { color: c.mutedForeground }]}>
                {label}
            </Text>
        </View>
    );
}

const kpiStyles = StyleSheet.create({
    card: {
        flex: 1,
        borderRadius: radius.xl,
        borderWidth: 1,
        padding: spacing.md,
        overflow: "hidden",
    },
    value: { fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
    label: {
        fontSize: fontSize.xs,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 1,
        marginTop: 4,
    },
});

export default function CoachHome() {
    const c = useThemeColors();
    const router = useRouter();
    const [data, setData] = useState<CoachDashboard | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const load = async () => {
        try {
            const d = await apiGet<CoachDashboard>("/api/mobile/dashboard");
            setData(d);
        } catch {
            // handle
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useFocusEffect(
        useCallback(() => {
            setLoading(true);
            load();
        }, [])
    );

    if (loading && !data) return <LoadingScreen />;
    if (!data) return <LoadingScreen />;

    const newCount = data.clients.filter(
        (cl) => cl.weekStatus === "new"
    ).length;
    const missingCount = data.clients.filter(
        (cl) => cl.weekStatus === "missing"
    ).length;
    const reviewedCount = data.clients.filter(
        (cl) => cl.weekStatus === "reviewed"
    ).length;

    const statusOrder: Record<string, number> = {
        new: 0,
        missing: 1,
        reviewed: 2,
    };
    const sorted = [...data.clients].sort(
        (a, b) =>
            (statusOrder[a.weekStatus] ?? 9) - (statusOrder[b.weekStatus] ?? 9)
    );

    return (
        <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
            <ScrollView
                contentContainerStyle={styles.scroll}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => {
                            setRefreshing(true);
                            load();
                        }}
                    />
                }
            >
                <Header title="Dashboard" />

                {/* KPI Cards */}
                {data.clients.length > 0 && (
                    <View style={styles.kpiGrid}>
                        <KpiCard
                            value={newCount}
                            label="Awaiting Review"
                            accentColor="#3b82f6"
                            colors={c}
                        />
                        <KpiCard
                            value={missingCount}
                            label="Missing"
                            accentColor="#f59e0b"
                            colors={c}
                        />
                        <KpiCard
                            value={reviewedCount}
                            label="Reviewed"
                            accentColor="#10b981"
                            colors={c}
                        />
                        <KpiCard
                            value={data.clients.length}
                            label="Total Clients"
                            accentColor={c.border}
                            colors={c}
                        />
                    </View>
                )}

                {/* Coach Code */}
                {data.user.coachCode && (
                    <Card style={{ marginBottom: spacing.lg }}>
                        <Text
                            style={[styles.sectionLabel, { color: c.mutedForeground }]}
                        >
                            Your Coach Code
                        </Text>
                        <Text style={[styles.codeValue, { color: c.foreground }]}>
                            {data.user.coachCode}
                        </Text>
                        <Text style={[styles.codeHint, { color: c.muted }]}>
                            Share this code with clients to connect.
                        </Text>
                    </Card>
                )}

                {/* Clients */}
                <Text style={[styles.listHeader, { color: c.foreground }]}>
                    Clients
                </Text>

                {data.clients.length === 0 ? (
                    <EmptyState
                        icon="👥"
                        title="No clients yet"
                        description="Share your coach code to start receiving check-ins."
                    />
                ) : (
                    sorted.map((client) => (
                        <TouchableOpacity
                            key={client.id}
                            activeOpacity={0.7}
                            onPress={() =>
                                router.push(`/(app)/coach/clients/${client.id}`)
                            }
                        >
                            <Card style={{ marginBottom: spacing.sm }}>
                                <View style={styles.clientRow}>
                                    <View
                                        style={[
                                            styles.avatar,
                                            { backgroundColor: c.cardElevated },
                                        ]}
                                    >
                                        <Text
                                            style={[styles.avatarText, { color: c.foreground }]}
                                        >
                                            {(client.firstName?.[0] ?? "?").toUpperCase()}
                                        </Text>
                                    </View>
                                    <View style={styles.clientInfo}>
                                        <Text
                                            style={[styles.clientName, { color: c.foreground }]}
                                        >
                                            {client.firstName} {client.lastName}
                                        </Text>
                                        <View style={styles.clientMeta}>
                                            {client.weight != null && (
                                                <Text
                                                    style={[styles.metaText, { color: c.muted }]}
                                                >
                                                    {client.weight} lbs
                                                    {client.weightChange != null &&
                                                        client.weightChange !== 0 && (
                                                            <Text
                                                                style={{
                                                                    color:
                                                                        client.weightChange < 0
                                                                            ? c.successText
                                                                            : c.dangerText,
                                                                }}
                                                            >
                                                                {" "}
                                                                {client.weightChange < 0 ? "↓" : "↑"}
                                                                {Math.abs(client.weightChange)}
                                                            </Text>
                                                        )}
                                                </Text>
                                            )}
                                            {client.dietCompliance != null && (
                                                <Text style={[styles.metaText, { color: c.muted }]}>
                                                    Diet {client.dietCompliance}/10
                                                </Text>
                                            )}
                                            {client.energyLevel != null && (
                                                <Text style={[styles.metaText, { color: c.muted }]}>
                                                    Energy {client.energyLevel}/10
                                                </Text>
                                            )}
                                            {client.hasClientMessage && (
                                                <Text
                                                    style={[
                                                        styles.metaText,
                                                        { color: c.warningText },
                                                    ]}
                                                >
                                                    💬
                                                </Text>
                                            )}
                                        </View>
                                    </View>
                                    <Badge
                                        label={
                                            client.weekStatus === "new"
                                                ? "New"
                                                : client.weekStatus === "reviewed"
                                                    ? "Reviewed"
                                                    : "Missing"
                                        }
                                        variant={
                                            client.weekStatus === "new"
                                                ? "warning"
                                                : client.weekStatus === "reviewed"
                                                    ? "success"
                                                    : "neutral"
                                        }
                                    />
                                </View>
                            </Card>
                        </TouchableOpacity>
                    ))
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1 },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
    kpiGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: spacing.sm,
        marginBottom: spacing.lg,
    },
    sectionLabel: {
        fontSize: fontSize.xs,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: spacing.xs,
    },
    codeValue: {
        fontSize: fontSize.xxl,
        fontWeight: "800",
        letterSpacing: 3,
    },
    codeHint: { fontSize: fontSize.xs, marginTop: 4 },
    listHeader: {
        fontSize: fontSize.lg,
        fontWeight: "700",
        letterSpacing: -0.3,
        marginBottom: spacing.md,
    },
    clientRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
    },
    avatarText: { fontSize: fontSize.base, fontWeight: "700" },
    clientInfo: { flex: 1 },
    clientName: { fontSize: fontSize.base, fontWeight: "600" },
    clientMeta: { flexDirection: "row", gap: spacing.sm, marginTop: 2 },
    metaText: { fontSize: fontSize.xs },
});
