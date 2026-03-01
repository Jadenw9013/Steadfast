import React from "react";
import { View, Text, TextInput, StyleSheet, TextInputProps } from "react-native";
import { useThemeColors, radius, spacing, fontSize } from "@/lib/theme";

interface InputProps extends TextInputProps {
    label?: string;
    error?: string;
}

export function Input({ label, error, style, ...props }: InputProps) {
    const c = useThemeColors();
    return (
        <View style={styles.container}>
            {label && (
                <Text style={[styles.label, { color: c.muted }]}>{label}</Text>
            )}
            <TextInput
                placeholderTextColor={c.mutedForeground}
                style={[
                    styles.input,
                    {
                        backgroundColor: c.cardElevated,
                        color: c.foreground,
                        borderColor: error ? c.destructive : c.border,
                    },
                    style,
                ]}
                {...props}
            />
            {error && (
                <Text style={[styles.error, { color: c.destructive }]}>{error}</Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginBottom: spacing.md,
    },
    label: {
        fontSize: fontSize.sm,
        fontWeight: "600",
        marginBottom: spacing.xs + 2,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    input: {
        borderRadius: radius.md,
        borderWidth: 1,
        paddingVertical: spacing.sm + 4,
        paddingHorizontal: spacing.md,
        fontSize: fontSize.base,
    },
    error: {
        fontSize: fontSize.xs,
        marginTop: spacing.xs,
    },
});
