import React from "react";
import { View, Text, StyleSheet, Alert, Linking, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@clerk/clerk-expo";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useThemeColors, spacing, fontSize } from "@/lib/theme";
import { Header } from "@/components/ui/Header";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { legal, appInfo } from "@/lib/legal";

export default function SettingsScreen() {
    const c = useThemeColors();
    const { signOut, userId } = useAuth();
    const router = useRouter();

    const handleSignOut = () => {
        Alert.alert("Sign Out", "Are you sure you want to sign out?", [
            { text: "Cancel", style: "cancel" },
            {
                text: "Sign Out",
                style: "destructive",
                onPress: async () => {
                    await signOut();
                    router.replace("/(auth)/sign-in");
                },
            },
        ]);
    };

    const openLink = (url: string) => Linking.openURL(url).catch(() => { });

    const copyDiagnostics = async () => {
        const info = JSON.stringify(
            {
                app: appInfo.appName,
                version: appInfo.version,
                build: appInfo.buildNumber,
                bundle: appInfo.bundleId,
                userId: userId ?? "unknown",
                ts: new Date().toISOString(),
            },
            null,
            2
        );
        try {
            await Clipboard.setStringAsync(info);
            Alert.alert("Copied", "Diagnostics copied to clipboard.");
        } catch {
            Alert.alert("Diagnostics", info);
        }
    };

    return (
        <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
            <ScrollView contentContainerStyle={styles.content}>
                <Header title="Settings" />

                <Card style={{ marginBottom: spacing.md }}>
                    <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>
                        Account
                    </Text>
                    <Text style={[styles.hint, { color: c.muted }]}>
                        Manage your profile and notification preferences on the web app.
                    </Text>
                </Card>

                <Card style={{ marginBottom: spacing.md }}>
                    <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>
                        Legal
                    </Text>
                    <LinkRow
                        label="Privacy Policy"
                        onPress={() => openLink(legal.privacyUrl)}
                        color={c}
                    />
                    <LinkRow
                        label="Terms of Service"
                        onPress={() => openLink(legal.termsUrl)}
                        color={c}
                    />
                    <LinkRow
                        label="Contact Support"
                        onPress={() => openLink(legal.supportUrl)}
                        color={c}
                    />
                    <LinkRow
                        label="Request Data Deletion"
                        onPress={() => openLink(legal.dataDeletionUrl)}
                        color={c}
                    />
                </Card>

                <Card style={{ marginBottom: spacing.md }}>
                    <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>
                        Support
                    </Text>
                    <Text style={[styles.hint, { color: c.muted }]}>
                        Contact: {legal.supportEmail}
                    </Text>
                    <View style={{ marginTop: spacing.sm }}>
                        <Button
                            title="Copy Diagnostics"
                            variant="secondary"
                            onPress={copyDiagnostics}
                        />
                    </View>
                </Card>

                <Card style={{ marginBottom: spacing.lg }}>
                    <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>
                        App Info
                    </Text>
                    <Text style={[styles.hint, { color: c.muted }]}>
                        {appInfo.appName} v{appInfo.version} (Build {appInfo.buildNumber})
                    </Text>
                </Card>

                <Button
                    title="Sign Out"
                    variant="destructive"
                    onPress={handleSignOut}
                />
            </ScrollView>
        </SafeAreaView>
    );
}

function LinkRow({
    label,
    onPress,
    color: c,
}: {
    label: string;
    onPress: () => void;
    color: ReturnType<typeof useThemeColors>;
}) {
    return (
        <Text onPress={onPress} style={[styles.link, { color: c.foreground }]}>
            {label} →
        </Text>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: spacing.xxl },
    sectionLabel: {
        fontSize: fontSize.xs,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: spacing.sm,
    },
    hint: { fontSize: fontSize.sm, lineHeight: 20 },
    link: {
        fontSize: fontSize.sm,
        fontWeight: "500",
        paddingVertical: 8,
    },
});
