import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { spacing, fontSize, radius } from "@/lib/theme";

interface Props {
    title?: string;
    message?: string;
    onRetry?: () => void;
}

export function ErrorScreen({ title, message, onRetry }: Props) {
    return (
        <View style={styles.container}>
            <Text style={styles.icon}>⚠️</Text>
            <Text style={styles.title}>{title ?? "Something went wrong"}</Text>
            <Text style={styles.message}>{message ?? "Please try again."}</Text>
            {onRetry && (
                <TouchableOpacity onPress={onRetry} style={styles.button}>
                    <Text style={styles.buttonText}>Retry</Text>
                </TouchableOpacity>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: spacing.xl,
        backgroundColor: "#0a0a0a",
    },
    icon: { fontSize: 48, marginBottom: spacing.md },
    title: {
        fontSize: fontSize.xl,
        fontWeight: "700",
        color: "#fafafa",
        marginBottom: spacing.sm,
    },
    message: {
        fontSize: fontSize.sm,
        color: "#a1a1aa",
        textAlign: "center",
        marginBottom: spacing.lg,
        lineHeight: 20,
    },
    button: {
        backgroundColor: "#27272a",
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: radius.md,
    },
    buttonText: {
        color: "#fafafa",
        fontSize: fontSize.sm,
        fontWeight: "600",
    },
});
