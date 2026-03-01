import React from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import { useThemeColors, radius, spacing } from "@/lib/theme";

interface CardProps {
    children: React.ReactNode;
    style?: ViewStyle;
}

export function Card({ children, style }: CardProps) {
    const c = useThemeColors();
    return (
        <View
            style={[
                styles.card,
                { backgroundColor: c.card, borderColor: c.borderLight },
                style,
            ]}
        >
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: radius.xl,
        borderWidth: 1,
        padding: spacing.lg,
        overflow: "hidden",
    },
});
