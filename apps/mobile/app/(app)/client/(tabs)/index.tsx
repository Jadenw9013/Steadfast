import React, { useCallback, useState } from "react";
import { ScrollView, View, Text, StyleSheet, RefreshControl, TouchableOpacity } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiGet } from "@/lib/api";
import { useThemeColors, spacing, fontSize, radius } from "@/lib/theme";
import { Header } from "@/components/ui/Header";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import type { ClientDashboard } from "@/lib/types";

export default function ClientHome() {
    const c = useThemeColors();
    const router = useRouter();
    const [data, setData] = useState<ClientDashboard | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const load = async () => {
        try {
            const d = await apiGet<ClientDashboard>("/api/mobile/dashboard");
            setData(d);
        } catch {
            // handle silently
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

    const latestWeight = data.checkIns.find((ci) => ci.weight != null);
    const prevWeight = latestWeight
        ? data.checkIns.find((ci) => ci.weight != null && ci.id !== latestWeight.id)
        : null;
    const weightDelta =
        latestWeight?.weight != null && prevWeight?.weight != null
            ? +(latestWeight.weight - prevWeight.weight).toFixed(1)
            : null;

    const todayLabel = new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });

    return (
        <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
            <ScrollView
                contentContainerStyle={styles.scroll}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
                }
            >
                <Header
                    title={data.user.firstName ? `${data.user.firstName}'s Week` : "Your Week"}
                    subtitle={todayLabel}
                    right={
                        data.coach ? (
                            <View style={[styles.coachBadge, { backgroundColor: c.card, borderColor: c.border }]}>
                                <View style={[styles.coachIcon, { backgroundColor: c.cardElevated }]}>
                                    <Text style={styles.coachInitial}>{data.coach.firstName?.[0] ?? "C"}</Text>
                                </View>
                                <Text style={[styles.coachName, { color: c.muted }]}>
                                    Coach {data.coach.firstName}
                                </Text>
                            </View>
                        ) : undefined
                    }
                />

                {/* Weight */}
                {latestWeight?.weight != null && (
                    <Card style={{ marginBottom: spacing.lg }}>
                        <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>
                            Current Weight
                        </Text>
                        <View style={styles.weightRow}>
                            <Text style={[styles.weightValue, { color: c.foreground }]}>
                                {latestWeight.weight}
                            </Text>
                            <Text style={[styles.weightUnit, { color: c.muted }]}>lbs</Text>
                            {weightDelta != null && weightDelta !== 0 && (
                                <Badge
                                    label={`${weightDelta < 0 ? "↓" : "↑"} ${Math.abs(weightDelta)} lbs`}
                                    variant={weightDelta < 0 ? "success" : "danger"}
                                />
                            )}
                        </View>
                    </Card>
                )}

                {/* Coach Feedback */}
                {data.latestCoachMessage && (
                    <Card style={{ marginBottom: spacing.lg }}>
                        <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>
                            Coach Feedback
                        </Text>
                        <Text
                            style={[styles.feedbackBody, { color: c.foreground }]}
                            numberOfLines={3}
                        >
                            {data.latestCoachMessage.body}
                        </Text>
                    </Card>
                )}

                {/* Meal Plan Summary */}
                {data.mealPlan && (
                    <TouchableOpacity
                        onPress={() => router.push("/(app)/client/(tabs)/meal-plan")}
                        activeOpacity={0.7}
                    >
                        <Card style={{ marginBottom: spacing.lg }}>
                            <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>
                                Meal Plan
                            </Text>
                            <Text style={[styles.mealSummary, { color: c.foreground }]}>
                                {data.mealPlan.items.length} items · {
                                    [...new Set(data.mealPlan.items.map((i) => i.mealName))].length
                                } meals
                            </Text>
                            <Text style={[styles.viewLink, { color: c.muted }]}>
                                View full plan →
                            </Text>
                        </Card>
                    </TouchableOpacity>
                )}

                {/* Recent Check-Ins */}
                <Text style={[styles.listHeader, { color: c.foreground }]}>
                    Recent Check-Ins
                </Text>
                {data.checkIns.length === 0 ? (
                    <EmptyState
                        icon="📋"
                        title="No check-ins yet"
                        actionLabel="Submit your first check-in"
                        onAction={() => router.push("/(app)/client/(tabs)/check-in")}
                    />
                ) : (
                    data.checkIns.slice(0, 10).map((ci) => {
                        const dateLabel = new Date(ci.submittedAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                        });
                        return (
                            <TouchableOpacity
                                key={ci.id}
                                activeOpacity={0.7}
                                onPress={() => router.push(`/(app)/client/check-ins/${ci.id}`)}
                            >
                                <Card style={{ marginBottom: spacing.sm }}>
                                    <View style={styles.checkInRow}>
                                        <View style={styles.checkInLeft}>
                                            {ci.weight != null ? (
                                                <Text style={[styles.ciWeight, { color: c.foreground }]}>
                                                    {ci.weight}
                                                    <Text style={[styles.ciWeightUnit, { color: c.muted }]}> lbs</Text>
                                                </Text>
                                            ) : (
                                                <Text style={[styles.ciWeight, { color: c.border }]}>—</Text>
                                            )}
                                            <Text style={[styles.ciDate, { color: c.foreground }]}>
                                                {dateLabel}
                                            </Text>
                                            {ci.notes && (
                                                <Text style={[styles.ciNotes, { color: c.muted }]} numberOfLines={1}>
                                                    {ci.notes}
                                                </Text>
                                            )}
                                        </View>
                                        <Badge
                                            label={ci.status === "REVIEWED" ? "Reviewed" : "Pending"}
                                            variant={ci.status === "REVIEWED" ? "success" : "warning"}
                                        />
                                    </View>
                                </Card>
                            </TouchableOpacity>
                        );
                    })
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1 },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
    sectionLabel: {
        fontSize: fontSize.xs,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: spacing.sm,
    },
    weightRow: {
        flexDirection: "row",
        alignItems: "baseline",
        gap: 6,
    },
    weightValue: {
        fontSize: 36,
        fontWeight: "700",
        letterSpacing: -1,
    },
    weightUnit: {
        fontSize: fontSize.sm,
        fontWeight: "500",
    },
    feedbackBody: {
        fontSize: fontSize.sm,
        lineHeight: 20,
    },
    mealSummary: {
        fontSize: fontSize.base,
        fontWeight: "600",
    },
    viewLink: {
        fontSize: fontSize.xs,
        fontWeight: "500",
        marginTop: 4,
    },
    listHeader: {
        fontSize: fontSize.lg,
        fontWeight: "700",
        letterSpacing: -0.3,
        marginBottom: spacing.md,
        marginTop: spacing.sm,
    },
    checkInRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    checkInLeft: {
        flex: 1,
        marginRight: spacing.sm,
    },
    ciWeight: {
        fontSize: fontSize.xl,
        fontWeight: "700",
    },
    ciWeightUnit: {
        fontSize: fontSize.xs,
        fontWeight: "400",
    },
    ciDate: {
        fontSize: fontSize.sm,
        fontWeight: "600",
        marginTop: 2,
    },
    ciNotes: {
        fontSize: fontSize.xs,
        marginTop: 2,
    },
    coachBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        borderRadius: radius.full,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    coachIcon: {
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
    },
    coachInitial: {
        fontSize: 10,
        fontWeight: "700",
    },
    coachName: {
        fontSize: fontSize.xs,
        fontWeight: "500",
    },
});
