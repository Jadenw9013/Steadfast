import React from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useThemeColors } from "@/lib/theme";

export function LoadingScreen() {
    const c = useThemeColors();
    return (
        <View style={[styles.container, { backgroundColor: c.background }]}>
            <ActivityIndicator size="large" color={c.muted} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
});
