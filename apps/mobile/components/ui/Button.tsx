import React from "react";
import {
    TouchableOpacity,
    Text,
    StyleSheet,
    ActivityIndicator,
    ViewStyle,
    TextStyle,
} from "react-native";
import { useThemeColors, radius, spacing, fontSize } from "@/lib/theme";

type Variant = "primary" | "secondary" | "ghost" | "destructive";

interface ButtonProps {
    title: string;
    onPress: () => void;
    variant?: Variant;
    loading?: boolean;
    disabled?: boolean;
    style?: ViewStyle;
    textStyle?: TextStyle;
}

export function Button({
    title,
    onPress,
    variant = "primary",
    loading = false,
    disabled = false,
    style,
    textStyle,
}: ButtonProps) {
    const c = useThemeColors();

    const bgMap: Record<Variant, string> = {
        primary: c.primary,
        secondary: c.cardElevated,
        ghost: "transparent",
        destructive: c.destructive,
    };

    const textMap: Record<Variant, string> = {
        primary: c.primaryForeground,
        secondary: c.foreground,
        ghost: c.foreground,
        destructive: "#ffffff",
    };

    return (
        <TouchableOpacity
            onPress={onPress}
            disabled={disabled || loading}
            activeOpacity={0.7}
            style={[
                styles.btn,
                {
                    backgroundColor: bgMap[variant],
                    opacity: disabled ? 0.5 : 1,
                    borderColor: variant === "secondary" ? c.border : "transparent",
                    borderWidth: variant === "secondary" ? 1 : 0,
                },
                style,
            ]}
        >
            {loading ? (
                <ActivityIndicator size="small" color={textMap[variant]} />
            ) : (
                <Text style={[styles.text, { color: textMap[variant] }, textStyle]}>
                    {title}
                </Text>
            )}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    btn: {
        borderRadius: radius.md,
        paddingVertical: spacing.sm + 4,
        paddingHorizontal: spacing.lg,
        alignItems: "center",
        justifyContent: "center",
    },
    text: {
        fontSize: fontSize.base,
        fontWeight: "600",
    },
});
