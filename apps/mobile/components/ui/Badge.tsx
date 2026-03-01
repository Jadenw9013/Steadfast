import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useThemeColors, radius, fontSize } from "@/lib/theme";

type BadgeVariant = "success" | "warning" | "danger" | "neutral";

interface BadgeProps {
    label: string;
    variant?: BadgeVariant;
}

export function Badge({ label, variant = "neutral" }: BadgeProps) {
    const c = useThemeColors();

    const bgMap: Record<BadgeVariant, string> = {
        success: c.successBg,
        warning: c.warningBg,
        danger: c.dangerBg,
        neutral: c.cardElevated,
    };

    const textMap: Record<BadgeVariant, string> = {
        success: c.successText,
        warning: c.warningText,
        danger: c.dangerText,
        neutral: c.muted,
    };

    return (
        <View style={[styles.badge, { backgroundColor: bgMap[variant] }]}>
            <Text style={[styles.text, { color: textMap[variant] }]}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    badge: {
        borderRadius: radius.full,
        paddingVertical: 3,
        paddingHorizontal: 10,
        alignSelf: "flex-start",
    },
    text: {
        fontSize: fontSize.xs,
        fontWeight: "600",
    },
});
