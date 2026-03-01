import React from "react";
import { View, Text, StyleSheet } from "react-native";

const IS_REVIEWER_MODE = process.env.EXPO_PUBLIC_REVIEWER_MODE === "true";

/**
 * Shows a small banner when EXPO_PUBLIC_REVIEWER_MODE=true.
 * Use in root layout to signal reviewers that the app is in review mode.
 */
export function ReviewerBanner() {
    if (!IS_REVIEWER_MODE) return null;

    return (
        <View style={styles.banner}>
            <Text style={styles.bannerText}>⚙ Reviewer Mode</Text>
        </View>
    );
}

/**
 * Returns true when reviewer mode is active.
 * Screens can use this to show demo/placeholder data if the API is unreachable.
 */
export function isReviewerMode(): boolean {
    return IS_REVIEWER_MODE;
}

const styles = StyleSheet.create({
    banner: {
        backgroundColor: "#f59e0b",
        paddingVertical: 4,
        alignItems: "center",
    },
    bannerText: {
        color: "#000",
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.5,
    },
});
