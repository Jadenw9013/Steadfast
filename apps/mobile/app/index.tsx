import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "@clerk/clerk-expo";
import { apiGet } from "@/lib/api";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import type { User } from "@/lib/types";

export default function Index() {
    const { isSignedIn, isLoaded, getToken } = useAuth();
    const router = useRouter();
    const [checking, setChecking] = useState(true);

    useEffect(() => {
        if (!isLoaded) return;
        if (!isSignedIn) {
            router.replace("/(auth)/sign-in");
            return;
        }

        (async () => {
            try {
                // Store token for API client
                const token = await getToken();
                if (token) {
                    const SecureStore = await import("expo-secure-store");
                    await SecureStore.setItemAsync("clerk_token", token);
                }

                const user = await apiGet<User>("/api/mobile/me");
                if (user.activeRole === "COACH") {
                    router.replace("/(app)/coach/(tabs)");
                } else {
                    router.replace("/(app)/client/(tabs)");
                }
            } catch {
                router.replace("/(auth)/sign-in");
            } finally {
                setChecking(false);
            }
        })();
    }, [isSignedIn, isLoaded]);

    if (checking || !isLoaded) return <LoadingScreen />;
    return <LoadingScreen />;
}
