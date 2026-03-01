import React, { useEffect } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { ClerkProvider, ClerkLoaded, useAuth } from "@clerk/clerk-expo";
import { tokenCache } from "@/lib/auth";
import { StatusBar } from "expo-status-bar";
import { View, StyleSheet } from "react-native";
import { useThemeColors } from "@/lib/theme";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ReviewerBanner } from "@/components/ReviewerBanner";

const clerkKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

// Debug: log key prefix to verify correct env var is loaded
console.log(
    "MOBILE CLERK KEY:",
    clerkKey ? `${clerkKey.substring(0, 10)}...` : "UNDEFINED"
);

// Guard: reject secret keys at startup
if (clerkKey && clerkKey.startsWith("sk_")) {
    throw new Error(
        "FATAL: Clerk received a SECRET key (sk_*) instead of a PUBLISHABLE key (pk_*). " +
        "Check apps/mobile/.env — EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY must start with pk_test_ or pk_live_."
    );
}

function AuthGate({ children }: { children: React.ReactNode }) {
    const { isSignedIn, isLoaded } = useAuth();
    const segments = useSegments();
    const router = useRouter();

    useEffect(() => {
        if (!isLoaded) return;
        const inAuth = segments[0] === "(auth)";
        if (!isSignedIn && !inAuth) {
            router.replace("/(auth)/sign-in");
        } else if (isSignedIn && inAuth) {
            router.replace("/");
        }
    }, [isSignedIn, isLoaded, segments]);

    return <>{children}</>;
}

function ThemedRoot() {
    const c = useThemeColors();
    return (
        <View style={[styles.root, { backgroundColor: c.background }]}>
            <StatusBar style="auto" />
            <ReviewerBanner />
            <ErrorBoundary>
                <AuthGate>
                    <Slot />
                </AuthGate>
            </ErrorBoundary>
        </View>
    );
}

export default function RootLayout() {
    return (
        <ClerkProvider publishableKey={clerkKey} tokenCache={tokenCache}>
            <ClerkLoaded>
                <ThemedRoot />
            </ClerkLoaded>
        </ClerkProvider>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
});
