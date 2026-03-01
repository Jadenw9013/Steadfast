import React from "react";
import { View, Text, StyleSheet, ViewStyle } from "react-native";
import { useThemeColors, spacing, fontSize } from "@/lib/theme";

interface HeaderProps {
    title: string;
    subtitle?: string;
    right?: React.ReactNode;
    style?: ViewStyle;
}

export function Header({ title, subtitle, right, style }: HeaderProps) {
    const c = useThemeColors();
    return (
        <View style={[styles.container, style]}>
            <View style={styles.left}>
                <Text style={[styles.title, { color: c.foreground }]}>{title}</Text>
                {subtitle && (
                    <Text style={[styles.subtitle, { color: c.muted }]}>{subtitle}</Text>
                )}
            </View>
            {right}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: spacing.lg,
    },
    left: {
        flex: 1,
    },
    title: {
        fontSize: fontSize.xxl,
        fontWeight: "700",
        letterSpacing: -0.5,
    },
    subtitle: {
        fontSize: fontSize.sm,
        marginTop: 4,
    },
});
