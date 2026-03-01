import React, { useCallback, useState } from "react";
import { ScrollView, View, Text, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiGet } from "@/lib/api";
import { useThemeColors, spacing, fontSize, radius } from "@/lib/theme";
import { Header } from "@/components/ui/Header";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import type { MealPlan, MealPlanItem } from "@/lib/types";

export default function MealPlanScreen() {
    const c = useThemeColors();
    const [mealPlan, setMealPlan] = useState<MealPlan | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const load = async () => {
        try {
            const res = await apiGet<{ mealPlan: MealPlan | null }>("/api/mobile/meal-plans");
            setMealPlan(res.mealPlan);
        } catch {
            // silently handle
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

    if (loading && !mealPlan) return <LoadingScreen />;

    // Group items by mealName
    const grouped: Record<string, MealPlanItem[]> = {};
    if (mealPlan) {
        for (const item of mealPlan.items) {
            if (!grouped[item.mealName]) grouped[item.mealName] = [];
            grouped[item.mealName].push(item);
        }
    }

    return (
        <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
            <ScrollView
                contentContainerStyle={styles.scroll}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
                }
            >
                <Header title="Your Meal Plan" />

                {!mealPlan ? (
                    <EmptyState
                        icon="🍽️"
                        title="No meal plan published"
                        description="Your coach hasn't published a meal plan yet."
                    />
                ) : (
                    Object.entries(grouped).map(([mealName, items]) => {
                        const totalCals = items.reduce((s, i) => s + i.calories, 0);
                        const totalProtein = items.reduce((s, i) => s + i.protein, 0);
                        const totalCarbs = items.reduce((s, i) => s + i.carbs, 0);
                        const totalFats = items.reduce((s, i) => s + i.fats, 0);

                        return (
                            <Card key={mealName} style={{ marginBottom: spacing.md }}>
                                <Text style={[styles.mealName, { color: c.foreground }]}>
                                    {mealName}
                                </Text>
                                <View style={[styles.macroRow, { borderColor: c.border }]}>
                                    <Text style={[styles.macroText, { color: c.muted }]}>
                                        {totalCals} cal · {totalProtein}p · {totalCarbs}c · {totalFats}f
                                    </Text>
                                </View>
                                {items.map((item, idx) => (
                                    <View
                                        key={idx}
                                        style={[
                                            styles.foodRow,
                                            idx < items.length - 1 && { borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth },
                                        ]}
                                    >
                                        <Text style={[styles.foodName, { color: c.foreground }]}>
                                            {item.foodName}
                                        </Text>
                                        <Text style={[styles.foodQty, { color: c.muted }]}>
                                            {item.quantity} {item.unit}
                                        </Text>
                                        <Text style={[styles.foodMacros, { color: c.mutedForeground }]}>
                                            {item.calories} cal · {item.protein}p · {item.carbs}c · {item.fats}f
                                        </Text>
                                    </View>
                                ))}
                            </Card>
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
    mealName: {
        fontSize: fontSize.lg,
        fontWeight: "700",
        letterSpacing: -0.3,
    },
    macroRow: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingBottom: spacing.sm,
        marginBottom: spacing.sm,
        marginTop: 4,
    },
    macroText: {
        fontSize: fontSize.xs,
        fontWeight: "600",
    },
    foodRow: {
        paddingVertical: spacing.sm,
    },
    foodName: {
        fontSize: fontSize.base,
        fontWeight: "600",
    },
    foodQty: {
        fontSize: fontSize.sm,
        marginTop: 2,
    },
    foodMacros: {
        fontSize: fontSize.xs,
        marginTop: 2,
    },
});
