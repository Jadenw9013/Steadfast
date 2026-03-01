import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColors, spacing, fontSize } from "@/lib/theme";
import { Header } from "@/components/ui/Header";
import { Card } from "@/components/ui/Card";

export default function CoachMessagesScreen() {
    const c = useThemeColors();

    return (
        <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
            <View style={styles.content}>
                <Header title="Messages" />
                <Card>
                    <Text style={[styles.hint, { color: c.muted }]}>
                        Tap a client from the Clients tab to open their message thread.
                    </Text>
                </Card>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1 },
    content: { padding: spacing.lg },
    hint: {
        fontSize: fontSize.sm,
        lineHeight: 20,
    },
});
