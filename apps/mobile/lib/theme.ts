import { useColorScheme } from "react-native";

export const colors = {
    light: {
        background: "#ffffff",
        foreground: "#171717",
        card: "#ffffff",
        cardElevated: "#fafafa",
        border: "#e4e4e7",
        borderLight: "rgba(228,228,231,0.8)",
        muted: "#71717a",
        mutedForeground: "#a1a1aa",
        primary: "#171717",
        primaryForeground: "#ffffff",
        destructive: "#ef4444",
        success: "#10b981",
        successBg: "rgba(16,185,129,0.1)",
        successText: "#059669",
        warning: "#f59e0b",
        warningBg: "rgba(245,158,11,0.1)",
        warningText: "#d97706",
        dangerBg: "rgba(239,68,68,0.1)",
        dangerText: "#ef4444",
    },
    dark: {
        background: "#09090b",
        foreground: "#ededed",
        card: "#121215",
        cardElevated: "#18181b",
        border: "#27272a",
        borderLight: "rgba(39,39,42,0.8)",
        muted: "#71717a",
        mutedForeground: "#a1a1aa",
        primary: "#ededed",
        primaryForeground: "#09090b",
        destructive: "#ef4444",
        success: "#34d399",
        successBg: "rgba(52,211,153,0.2)",
        successText: "#34d399",
        warning: "#fbbf24",
        warningBg: "rgba(251,191,36,0.2)",
        warningText: "#fbbf24",
        dangerBg: "rgba(239,68,68,0.2)",
        dangerText: "#f87171",
    },
};

export function useThemeColors() {
    const scheme = useColorScheme();
    return scheme === "dark" ? colors.dark : colors.light;
}

export const spacing = {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
};

export const radius = {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    full: 9999,
};

export const fontSize = {
    xs: 11,
    sm: 13,
    base: 15,
    lg: 17,
    xl: 20,
    xxl: 24,
    xxxl: 30,
};
