import React, { useCallback, useState } from "react";
import {
    ScrollView,
    View,
    Text,
    TextInput,
    StyleSheet,
    Alert,
    KeyboardAvoidingView,
    Platform,
} from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { useThemeColors, spacing, fontSize, radius } from "@/lib/theme";
import { Header } from "@/components/ui/Header";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { WeightChart } from "@/components/ui/WeightChart";
import type { CheckInLight, Message } from "@/lib/types";

interface ClientProfile {
    client: { id: string; firstName: string | null; lastName: string | null; email: string };
    coachNotes: string | null;
    latestCheckIn: CheckInLight | null;
    weightDelta: number | null;
    currentWeekStatus: "submitted" | "reviewed" | "missing";
    checkIns: CheckInLight[];
}

function getWeekStartDate(): string {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff));
    return monday.toISOString().split("T")[0];
}

export default function ClientDetailScreen() {
    const { clientId } = useLocalSearchParams<{ clientId: string }>();
    const c = useThemeColors();
    const [profile, setProfile] = useState<ClientProfile | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMsg, setNewMsg] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [marking, setMarking] = useState(false);

    const weekStartDate = getWeekStartDate();

    const load = async () => {
        try {
            const [p, m] = await Promise.all([
                apiGet<ClientProfile>(`/api/mobile/clients/${clientId}`),
                apiGet<{ messages: Message[] }>(
                    `/api/mobile/messages?clientId=${clientId}&weekStartDate=${weekStartDate}`
                ),
            ]);
            setProfile(p);
            setMessages(m.messages);
        } catch {
            // handle
        } finally {
            setLoading(false);
        }
    };

    useFocusEffect(
        useCallback(() => {
            setLoading(true);
            load();
        }, [clientId])
    );

    const markReviewed = async () => {
        if (!profile?.latestCheckIn?.id) return;
        setMarking(true);
        try {
            await apiPatch(`/api/mobile/check-ins/${profile.latestCheckIn.id}`);
            Alert.alert("Done", "Check-in marked as reviewed.");
            load();
        } catch (err) {
            Alert.alert("Error", err instanceof Error ? err.message : "Failed");
        } finally {
            setMarking(false);
        }
    };

    const sendMessage = async () => {
        if (!newMsg.trim()) return;
        setSending(true);
        try {
            await apiPost("/api/mobile/messages", {
                clientId,
                weekStartDate,
                body: newMsg.trim(),
            });
            setNewMsg("");
            load();
        } catch {
            // handle
        } finally {
            setSending(false);
        }
    };

    if (loading || !profile) return <LoadingScreen />;

    const ci = profile.latestCheckIn;

    return (
        <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                style={styles.flex}
            >
                <ScrollView contentContainerStyle={styles.scroll}>
                    <Header
                        title={`${profile.client.firstName ?? ""} ${profile.client.lastName ?? ""}`.trim() || "Client"}
                        subtitle={profile.client.email}
                    />

                    {/* Latest Check-In */}
                    <Card style={{ marginBottom: spacing.md }}>
                        <View style={styles.cardHeader}>
                            <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>
                                Latest Check-In
                            </Text>
                            <Badge
                                label={
                                    profile.currentWeekStatus === "reviewed"
                                        ? "Reviewed"
                                        : profile.currentWeekStatus === "submitted"
                                            ? "Pending"
                                            : "Missing"
                                }
                                variant={
                                    profile.currentWeekStatus === "reviewed"
                                        ? "success"
                                        : profile.currentWeekStatus === "submitted"
                                            ? "warning"
                                            : "neutral"
                                }
                            />
                        </View>
                        {ci ? (
                            <>
                                <View style={styles.statRow}>
                                    <View style={styles.stat}>
                                        <Text style={[styles.statLabel, { color: c.mutedForeground }]}>Weight</Text>
                                        <Text style={[styles.statValue, { color: c.foreground }]}>
                                            {ci.weight != null ? `${ci.weight} lbs` : "—"}
                                        </Text>
                                        {profile.weightDelta != null && profile.weightDelta !== 0 && (
                                            <Text
                                                style={{
                                                    fontSize: fontSize.xs,
                                                    fontWeight: "600",
                                                    color: profile.weightDelta < 0 ? c.successText : c.dangerText,
                                                }}
                                            >
                                                {profile.weightDelta < 0 ? "↓" : "↑"} {Math.abs(profile.weightDelta)}
                                            </Text>
                                        )}
                                    </View>
                                </View>
                                {ci.notes && (
                                    <Text style={[styles.ciNotes, { color: c.foreground }]}>
                                        {ci.notes}
                                    </Text>
                                )}
                                {profile.currentWeekStatus === "submitted" && (
                                    <Button
                                        title="Mark Reviewed"
                                        onPress={markReviewed}
                                        loading={marking}
                                        variant="secondary"
                                        style={{ marginTop: spacing.md }}
                                    />
                                )}
                            </>
                        ) : (
                            <Text style={[styles.emptyText, { color: c.muted }]}>
                                No check-in this week.
                            </Text>
                        )}
                    </Card>

                    {/* Weight Chart */}
                    {profile.checkIns.length >= 2 && (
                        <Card style={{ marginBottom: spacing.md }}>
                            <Text style={[styles.sectionLabel, { color: c.mutedForeground, marginBottom: spacing.sm }]}>
                                Weight Trend
                            </Text>
                            <WeightChart
                                data={profile.checkIns
                                    .filter((ci) => ci.weight != null)
                                    .map((ci) => ({
                                        date: ci.submittedAt,
                                        weight: ci.weight!,
                                    }))}
                            />
                        </Card>
                    )}

                    {/* Messages */}
                    <Text style={[styles.listHeader, { color: c.foreground }]}>Messages</Text>
                    {messages.length > 0 && (
                        <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
                            {messages.map((msg) => (
                                <View
                                    key={msg.id}
                                    style={[
                                        styles.bubble,
                                        {
                                            backgroundColor: msg.sender.activeRole === "COACH" ? c.primary : c.card,
                                            borderColor: msg.sender.activeRole === "COACH" ? "transparent" : c.borderLight,
                                            alignSelf: msg.sender.activeRole === "COACH" ? "flex-end" : "flex-start",
                                        },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.msgBody,
                                            {
                                                color: msg.sender.activeRole === "COACH" ? c.primaryForeground : c.foreground,
                                            },
                                        ]}
                                    >
                                        {msg.body}
                                    </Text>
                                    <Text
                                        style={[
                                            styles.msgTime,
                                            {
                                                color: msg.sender.activeRole === "COACH" ? "rgba(255,255,255,0.6)" : c.muted,
                                            },
                                        ]}
                                    >
                                        {msg.sender.firstName} ·{" "}
                                        {new Date(msg.createdAt).toLocaleTimeString("en-US", {
                                            hour: "numeric",
                                            minute: "2-digit",
                                        })}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    )}

                    <View style={[styles.inputRow, { borderColor: c.border }]}>
                        <TextInput
                            value={newMsg}
                            onChangeText={setNewMsg}
                            placeholder="Send a message..."
                            placeholderTextColor={c.mutedForeground}
                            style={[
                                styles.msgInput,
                                { color: c.foreground, backgroundColor: c.cardElevated, borderColor: c.border },
                            ]}
                            multiline
                        />
                        <Button
                            title="Send"
                            onPress={sendMessage}
                            loading={sending}
                            disabled={!newMsg.trim()}
                            style={{ paddingHorizontal: spacing.md }}
                        />
                    </View>

                    {/* Check-In History */}
                    {profile.checkIns.length > 1 && (
                        <>
                            <Text style={[styles.listHeader, { color: c.foreground, marginTop: spacing.lg }]}>
                                History
                            </Text>
                            {profile.checkIns.slice(0, 8).map((item) => (
                                <Card key={item.id} style={{ marginBottom: spacing.sm }}>
                                    <View style={styles.histRow}>
                                        <Text style={[styles.histWeight, { color: c.foreground }]}>
                                            {item.weight != null ? `${item.weight} lbs` : "—"}
                                        </Text>
                                        <Text style={[styles.histDate, { color: c.muted }]}>
                                            {new Date(item.submittedAt).toLocaleDateString("en-US", {
                                                month: "short",
                                                day: "numeric",
                                            })}
                                        </Text>
                                        <Badge
                                            label={item.status === "REVIEWED" ? "Reviewed" : "Pending"}
                                            variant={item.status === "REVIEWED" ? "success" : "warning"}
                                        />
                                    </View>
                                </Card>
                            ))}
                        </>
                    )}
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1 },
    flex: { flex: 1 },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
    sectionLabel: {
        fontSize: fontSize.xs,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 1,
    },
    cardHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: spacing.sm,
    },
    statRow: {
        flexDirection: "row",
        gap: spacing.xl,
    },
    stat: { alignItems: "center" },
    statLabel: { fontSize: fontSize.xs, fontWeight: "600", textTransform: "uppercase", marginBottom: 2 },
    statValue: { fontSize: fontSize.xl, fontWeight: "700" },
    ciNotes: { fontSize: fontSize.sm, lineHeight: 20, marginTop: spacing.sm },
    emptyText: { fontSize: fontSize.sm },
    listHeader: {
        fontSize: fontSize.lg,
        fontWeight: "700",
        letterSpacing: -0.3,
        marginBottom: spacing.md,
    },
    bubble: {
        borderRadius: radius.lg,
        padding: spacing.sm + 4,
        maxWidth: "80%",
        borderWidth: 1,
    },
    msgBody: { fontSize: fontSize.sm, lineHeight: 20 },
    msgTime: { fontSize: fontSize.xs, marginTop: 4 },
    inputRow: {
        flexDirection: "row",
        alignItems: "flex-end",
        gap: spacing.sm,
        paddingTop: spacing.sm,
        borderTopWidth: 1,
        marginBottom: spacing.md,
    },
    msgInput: {
        flex: 1,
        borderRadius: radius.md,
        borderWidth: 1,
        paddingHorizontal: spacing.sm + 4,
        paddingVertical: spacing.sm,
        fontSize: fontSize.base,
        maxHeight: 80,
    },
    histRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    histWeight: { fontSize: fontSize.base, fontWeight: "700", width: 80 },
    histDate: { fontSize: fontSize.sm, flex: 1 },
});
