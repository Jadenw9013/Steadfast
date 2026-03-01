import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { spacing, fontSize, radius } from "@/lib/theme";

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, errorMessage: "" };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, errorMessage: error.message || "Something went wrong" };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("ErrorBoundary caught:", error, info);
    }

    handleRetry = () => {
        this.setState({ hasError: false, errorMessage: "" });
    };

    render() {
        if (this.state.hasError) {
            return (
                <View style={styles.container}>
                    <Text style={styles.icon}>⚠️</Text>
                    <Text style={styles.title}>Something went wrong</Text>
                    <Text style={styles.message}>{this.state.errorMessage}</Text>
                    <TouchableOpacity onPress={this.handleRetry} style={styles.button}>
                        <Text style={styles.buttonText}>Try Again</Text>
                    </TouchableOpacity>
                </View>
            );
        }
        return this.props.children;
    }
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
