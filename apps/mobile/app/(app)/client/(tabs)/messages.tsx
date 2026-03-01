import React, { useCallback, useState, useRef } from "react";
import {
    ScrollView,
    View,
    Text,
    TextInput,
    StyleSheet,
    RefreshControl,
    KeyboardAvoidingView,
    Platform,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiGet, apiPost } from "@/lib/api";
import { useThemeColors, spacing, fontSize, radius } from "@/lib/theme";
import { Header } from "@/components/ui/Header";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import type { Message, User } from "@/lib/types";

function getWeekStartDate(): string {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now);
    monday.setDate(diff);
    return monday.toISOString().split("T")[0];
}

export default function MessagesScreen() {
    const c = useThemeColors();
    const scrollRef = useRef<ScrollView>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [user, setUser] = useState<User | null>(null);
    const [newMsg, setNewMsg] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const weekStartDate = getWeekStartDate();

    const load = async () => {
        try {
            const [u, m] = await Promise.all([
                apiGet<User>("/api/mobile/me"),
                apiGet<{ messages: Message[] }>(
                    `/api/mobile/messages?clientId=&weekStartDate=${weekStartDate}`
                ),
            ]);
            setUser(u);
            setMessages(m.messages);
        } catch {
            // handle
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useFocusEffect(
        useCallback(() => {
            setLoading(true);
            load();
        }, [])
    );

    const send = async () => {
        if (!newMsg.trim() || !user) return;

        // Optimistic: add message immediately
        const optimisticId = `opt-${Date.now()}`;
        const optimisticMsg: Message = {
            id: optimisticId,
            body: newMsg.trim(),
            createdAt: new Date().toISOString(),
            sender: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                activeRole: user.activeRole,
            },
        };
        const previousMessages = [...messages];
        setMessages((prev) => [...prev, optimisticMsg]);
        setNewMsg("");
        setSending(true);

        // Scroll to bottom
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

        try {
            await apiPost("/api/mobile/messages", {
                clientId: user.id,
                weekStartDate,
                body: optimisticMsg.body,
            });
            // Reload to get real message with server ID
            await load();
        } catch {
            // Rollback on failure
            setMessages(previousMessages);
            setNewMsg(optimisticMsg.body);
        } finally {
            setSending(false);
        }
    };

    if (loading && !user) return <LoadingScreen />;

    const weekLabel = new Date(weekStartDate).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });

    return (
        <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                style={styles.flex}
                keyboardVerticalOffset={90}
            >
                <View style={[styles.threadHeader, { borderBottomColor: c.border }]}>
                    <Header
                        title="Messages"
                        subtitle={`Week of ${weekLabel}`}
                        style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, marginBottom: 0 }}
                    />
                </View>

                <ScrollView
                    ref={scrollRef}
                    contentContainerStyle={styles.scroll}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={() => {
                                setRefreshing(true);
                                load();
                            }}
                        />
                    }
                    onContentSizeChange={() =>
                        scrollRef.current?.scrollToEnd({ animated: false })
                    }
                >
                    {messages.length === 0 ? (
                        <EmptyState
                            icon="💬"
                            title="No messages this week"
                            description="Start a conversation with your coach."
                        />
                    ) : (
                        messages.map((msg) => {
                            const isMe = msg.sender.id === user?.id;
                            const isOptimistic = msg.id.startsWith("opt-");
                            return (
                                <View
                                    key={msg.id}
                                    style={[
                                        styles.bubbleWrap,
                                        isMe ? styles.bubbleRight : styles.bubbleLeft,
                                    ]}
                                >
                                    <View
                                        style={[
                                            styles.bubble,
                                            {
                                                backgroundColor: isMe ? c.primary : c.card,
                                                borderColor: isMe ? "transparent" : c.borderLight,
                                                opacity: isOptimistic ? 0.6 : 1,
                                            },
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.senderName,
                                                {
                                                    color: isMe ? "rgba(255,255,255,0.7)" : c.muted,
                                                },
                                            ]}
                                        >
                                            {msg.sender.firstName ?? "User"}
                                            {msg.sender.activeRole === "COACH" ? " (Coach)" : ""}
                                        </Text>
                                        <Text
                                            style={[
                                                styles.msgBody,
                                                {
                                                    color: isMe ? c.primaryForeground : c.foreground,
                                                },
                                            ]}
                                        >
                                            {msg.body}
                                        </Text>
                                        <Text
                                            style={[
                                                styles.msgTime,
                                                {
                                                    color: isMe ? "rgba(255,255,255,0.5)" : c.muted,
                                                },
                                            ]}
                                        >
                                            {new Date(msg.createdAt).toLocaleString(undefined, {
                                                month: "short",
                                                day: "numeric",
                                                hour: "numeric",
                                                minute: "2-digit",
                                            })}
                                        </Text>
                                    </View>
                                </View>
                            );
                        })
                    )}
                </ScrollView>

                <View
                    style={[
                        styles.inputBar,
                        { backgroundColor: c.card, borderTopColor: c.border },
                    ]}
                >
                    <TextInput
                        value={newMsg}
                        onChangeText={setNewMsg}
                        placeholder="Type a message..."
                        placeholderTextColor={c.mutedForeground}
                        style={[
                            styles.msgInput,
                            {
                                color: c.foreground,
                                backgroundColor: c.cardElevated,
                                borderColor: c.border,
                            },
                        ]}
                        multiline
                    />
                    <Button
                        title={sending ? "..." : "Send"}
                        onPress={send}
                        loading={false}
                        disabled={!newMsg.trim() || sending}
                        style={{ paddingHorizontal: spacing.md }}
                    />
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1 },
    flex: { flex: 1 },
    threadHeader: { borderBottomWidth: 1 },
    scroll: { padding: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
    bubbleWrap: { maxWidth: "80%" },
    bubbleLeft: { alignSelf: "flex-start" },
    bubbleRight: { alignSelf: "flex-end" },
    bubble: {
        borderRadius: radius.lg,
        padding: spacing.sm + 4,
        borderWidth: 1,
    },
    senderName: {
        fontSize: fontSize.xs,
        fontWeight: "500",
        marginBottom: 2,
    },
    msgBody: {
        fontSize: fontSize.sm,
        lineHeight: 20,
    },
    msgTime: {
        fontSize: fontSize.xs,
        marginTop: 4,
    },
    inputBar: {
        flexDirection: "row",
        alignItems: "flex-end",
        padding: spacing.sm + 4,
        borderTopWidth: 1,
        gap: spacing.sm,
    },
    msgInput: {
        flex: 1,
        borderRadius: radius.md,
        borderWidth: 1,
        paddingHorizontal: spacing.sm + 4,
        paddingVertical: spacing.sm,
        fontSize: fontSize.base,
        maxHeight: 100,
    },
});
