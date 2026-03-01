import React, { useState } from "react";
import {
    View,
    Text,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
} from "react-native";
import { useSignIn } from "@clerk/clerk-expo";
import { useRouter } from "expo-router";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useThemeColors, spacing, fontSize, radius } from "@/lib/theme";

export default function SignInScreen() {
    const { signIn, setActive, isLoaded } = useSignIn();
    const router = useRouter();
    const c = useThemeColors();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const onSubmit = async () => {
        if (!isLoaded) return;
        setLoading(true);
        setError("");
        try {
            const result = await signIn.create({
                identifier: email,
                password,
            });
            if (result.status === "complete") {
                await setActive({ session: result.createdSessionId });
                router.replace("/");
            }
        } catch (err: unknown) {
            const message =
                err && typeof err === "object" && "errors" in err
                    ? (err as { errors: { message: string }[] }).errors[0]?.message
                    : "Sign in failed";
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={[styles.flex, { backgroundColor: c.background }]}
        >
            <ScrollView
                contentContainerStyle={styles.container}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.header}>
                    <View
                        style={[styles.iconWrap, { backgroundColor: c.cardElevated }]}
                    >
                        <Text style={styles.icon}>💪</Text>
                    </View>
                    <Text style={[styles.title, { color: c.foreground }]}>
                        Coach Platform
                    </Text>
                    <Text style={[styles.subtitle, { color: c.muted }]}>
                        Sign in to your account
                    </Text>
                </View>

                <View
                    style={[
                        styles.card,
                        { backgroundColor: c.card, borderColor: c.borderLight },
                    ]}
                >
                    {error !== "" && (
                        <View
                            style={[styles.errorBox, { backgroundColor: c.dangerBg }]}
                        >
                            <Text style={[styles.errorText, { color: c.dangerText }]}>
                                {error}
                            </Text>
                        </View>
                    )}

                    <Input
                        label="Email"
                        value={email}
                        onChangeText={setEmail}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        textContentType="emailAddress"
                    />
                    <Input
                        label="Password"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                        textContentType="password"
                    />
                    <Button
                        title="Sign In"
                        onPress={onSubmit}
                        loading={loading}
                        disabled={!email || !password}
                    />
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    container: {
        flexGrow: 1,
        justifyContent: "center",
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.xxl,
    },
    header: {
        alignItems: "center",
        marginBottom: spacing.xl,
    },
    iconWrap: {
        width: 56,
        height: 56,
        borderRadius: radius.lg,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: spacing.md,
    },
    icon: {
        fontSize: 28,
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
    card: {
        borderRadius: radius.xl,
        borderWidth: 1,
        padding: spacing.lg,
    },
    errorBox: {
        borderRadius: radius.md,
        padding: spacing.sm + 4,
        marginBottom: spacing.md,
    },
    errorText: {
        fontSize: fontSize.sm,
        fontWeight: "500",
    },
});
