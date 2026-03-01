import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useThemeColors, spacing, fontSize, radius } from "@/lib/theme";

interface EmptyStateProps {
    icon?: string;
    title: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
}

export function EmptyState({
    icon = "📋",
    title,
    description,
    actionLabel,
    onAction,
}: EmptyStateProps) {
    const c = useThemeColors();
    return (
        <View
            style={[
                styles.container,
                { borderColor: c.border, backgroundColor: c.card },
            ]}
        >
            <Text style={styles.icon}>{icon}</Text>
            <Text style={[styles.title, { color: c.foreground }]}>{title}</Text>
            {description && (
                <Text style={[styles.desc, { color: c.muted }]}>{description}</Text>
            )}
            {actionLabel && onAction && (
                <TouchableOpacity onPress={onAction}>
                    <Text style={[styles.action, { color: c.foreground }]}>
                        {actionLabel}
                    </Text>
                </TouchableOpacity>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderStyle: "dashed",
        borderRadius: radius.xl,
        paddingVertical: spacing.xxl,
        paddingHorizontal: spacing.lg,
        alignItems: "center",
        gap: spacing.sm,
    },
    icon: {
        fontSize: 32,
    },
    title: {
        fontSize: fontSize.base,
        fontWeight: "600",
    },
    desc: {
        fontSize: fontSize.sm,
        textAlign: "center",
    },
    action: {
        fontSize: fontSize.sm,
        fontWeight: "600",
        textDecorationLine: "underline",
        marginTop: spacing.xs,
    },
});
