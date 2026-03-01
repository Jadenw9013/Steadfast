import React, { useState, useCallback } from "react";
import {
    ScrollView,
    View,
    Text,
    TextInput,
    StyleSheet,
    Alert,
    KeyboardAvoidingView,
    Platform,
    Image,
    TouchableOpacity,
    Modal,
    ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { apiGet, apiPost } from "@/lib/api";
import { useThemeColors, spacing, fontSize, radius } from "@/lib/theme";
import { Header } from "@/components/ui/Header";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const DIET_ENERGY_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);
const MAX_PHOTOS = 3;

interface TemplateQuestion {
    id: string;
    label: string;
    type: "shortText" | "longText" | "number" | "boolean" | "scale";
    required: boolean;
    sortOrder: number;
    config: Record<string, unknown>;
}

interface UploadResult {
    fileName: string;
    signedUrl: string;
    token: string;
    publicPath: string;
}

export default function CheckInScreen() {
    const c = useThemeColors();
    const router = useRouter();

    const [weight, setWeight] = useState("");
    const [dietCompliance, setDietCompliance] = useState<number | null>(null);
    const [energyLevel, setEnergyLevel] = useState<number | null>(null);
    const [notes, setNotes] = useState("");
    const [photos, setPhotos] = useState<{ uri: string; name: string }[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploadState, setUploadState] = useState("");
    const [uploadProgress, setUploadProgress] = useState(0);
    const [previousWeight, setPreviousWeight] = useState<number | null>(null);

    // Template
    const [templateId, setTemplateId] = useState<string | null>(null);
    const [questions, setQuestions] = useState<TemplateQuestion[]>([]);
    const [customResponses, setCustomResponses] = useState<Record<string, string>>({});

    // Conflict modal
    const [conflictVisible, setConflictVisible] = useState(false);
    const [conflictTime, setConflictTime] = useState("");
    const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);

    // Load previous weight + template
    useFocusEffect(
        useCallback(() => {
            (async () => {
                try {
                    const [ciRes, tmplRes] = await Promise.all([
                        apiGet<{ checkIns: { weight: number | null }[] }>("/api/mobile/check-ins"),
                        apiGet<{ templateId: string | null; questions: TemplateQuestion[] }>(
                            "/api/mobile/templates/current"
                        ),
                    ]);
                    const latest = ciRes.checkIns?.find((ci) => ci.weight != null);
                    if (latest?.weight) setPreviousWeight(latest.weight);
                    setTemplateId(tmplRes.templateId);
                    setQuestions(
                        [...(tmplRes.questions || [])].sort((a, b) => a.sortOrder - b.sortOrder)
                    );
                } catch {
                    /* ignore */
                }
            })();
        }, [])
    );

    const pickImages = async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
            Alert.alert("Permission needed", "Please allow photo access to attach progress photos.");
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            allowsMultipleSelection: true,
            selectionLimit: MAX_PHOTOS - photos.length,
            quality: 0.8,
        });
        if (!result.canceled) {
            setPhotos((prev) =>
                [
                    ...prev,
                    ...result.assets.map((a) => ({
                        uri: a.uri,
                        name: a.fileName || `photo-${Date.now()}.jpg`,
                    })),
                ].slice(0, MAX_PHOTOS)
            );
        }
    };

    const takePhoto = async () => {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
            Alert.alert("Permission needed", "Please allow camera access to take progress photos.");
            return;
        }
        const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
        if (!result.canceled && photos.length < MAX_PHOTOS) {
            setPhotos((prev) => [
                ...prev,
                { uri: result.assets[0].uri, name: `camera-${Date.now()}.jpg` },
            ]);
        }
    };

    const removePhoto = (idx: number) => {
        setPhotos((prev) => prev.filter((_, i) => i !== idx));
    };

    async function uploadPhotos(): Promise<string[]> {
        if (photos.length === 0) return [];

        setUploadState("Getting upload URLs...");
        setUploadProgress(0);

        const files = photos.map((p) => ({
            fileName: p.name,
            contentType: "image/jpeg",
        }));

        const { uploads } = await apiPost<{ uploads: UploadResult[] }>(
            "/api/mobile/upload",
            { files }
        );

        setUploadState("Uploading photos...");
        const paths: string[] = [];

        for (let i = 0; i < uploads.length; i++) {
            const upload = uploads[i];
            const photo = photos[i];

            // Fetch the local file as blob
            const response = await fetch(photo.uri);
            const blob = await response.blob();

            // Upload via PUT to signed URL
            let attempts = 0;
            let success = false;
            while (attempts < 3 && !success) {
                try {
                    const putRes = await fetch(upload.signedUrl, {
                        method: "PUT",
                        headers: {
                            "Content-Type": "image/jpeg",
                            "x-upsert": "true",
                        },
                        body: blob,
                    });
                    if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
                    success = true;
                } catch (err) {
                    attempts++;
                    if (attempts >= 3) throw err;
                    await new Promise((r) => setTimeout(r, 1000));
                }
            }

            paths.push(upload.publicPath);
            setUploadProgress(((i + 1) / uploads.length) * 100);
        }

        return paths;
    }

    async function submitPayload(payload: Record<string, unknown>) {
        setUploadState("Saving check-in...");
        const res = await fetch(
            `${process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:3000"}/api/mobile/check-ins`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(await getAuthHeader()),
                },
                body: JSON.stringify(payload),
            }
        );

        if (res.status === 409) {
            const data = await res.json();
            const submittedAt = data.conflict?.existing?.submittedAt;
            setConflictTime(
                submittedAt
                    ? new Date(submittedAt).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                    })
                    : "earlier today"
            );
            setPendingPayload(payload);
            setConflictVisible(true);
            return;
        }

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `Submission failed (${res.status})`);
        }

        Alert.alert("Success", "Check-in submitted!", [
            { text: "OK", onPress: () => router.push("/(app)/client/(tabs)") },
        ]);
        resetForm();
    }

    async function getAuthHeader(): Promise<Record<string, string>> {
        try {
            const SecureStore = await import("expo-secure-store");
            const token = await SecureStore.getItemAsync("clerk_token");
            return token ? { Authorization: `Bearer ${token}` } : {};
        } catch {
            return {};
        }
    }

    function resetForm() {
        setWeight("");
        setDietCompliance(null);
        setEnergyLevel(null);
        setNotes("");
        setPhotos([]);
        setCustomResponses({});
        setUploadState("");
        setUploadProgress(0);
    }

    const buildPayload = (photoPaths: string[], overwrite?: boolean) => {
        const responsesPayload = Object.fromEntries(
            Object.entries(customResponses).filter(([, v]) => v !== "")
        );

        return {
            weight: parseFloat(weight),
            dietCompliance: dietCompliance ?? undefined,
            energyLevel: energyLevel ?? undefined,
            notes: notes || undefined,
            photoPaths,
            overwriteToday: overwrite ?? undefined,
            templateId: templateId ?? undefined,
            customResponses:
                Object.keys(responsesPayload).length > 0
                    ? responsesPayload
                    : undefined,
        };
    };

    const onSubmit = async () => {
        if (!weight || isNaN(parseFloat(weight))) {
            Alert.alert("Weight is required");
            return;
        }

        // Validate required custom questions
        for (const q of questions) {
            if (q.required && !customResponses[q.id]?.trim()) {
                Alert.alert("Required", `${q.label} is required.`);
                return;
            }
        }

        setLoading(true);
        try {
            const photoPaths = await uploadPhotos();
            const payload = buildPayload(photoPaths);
            await submitPayload(payload);
        } catch (err) {
            Alert.alert("Error", err instanceof Error ? err.message : "Submission failed");
        } finally {
            setLoading(false);
            setUploadState("");
        }
    };

    const handleOverwrite = async () => {
        setConflictVisible(false);
        if (!pendingPayload) return;
        setLoading(true);
        try {
            await submitPayload({ ...pendingPayload, overwriteToday: true });
        } catch (err) {
            Alert.alert("Error", err instanceof Error ? err.message : "Failed");
        } finally {
            setLoading(false);
            setPendingPayload(null);
        }
    };

    const handleCancelConflict = () => {
        setConflictVisible(false);
        setPendingPayload(null);
    };

    return (
        <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                style={styles.flex}
            >
                <ScrollView
                    contentContainerStyle={styles.scroll}
                    keyboardShouldPersistTaps="handled"
                >
                    <Header title="Weekly Check-In" subtitle="Log your progress for the week" />

                    <Card>
                        {/* Weight */}
                        <View style={styles.fieldGroup}>
                            <Text style={[styles.label, { color: c.muted }]}>
                                Weight (lbs) <Text style={{ color: c.destructive }}>*</Text>
                            </Text>
                            <View style={styles.weightRow}>
                                <Input
                                    value={weight}
                                    onChangeText={setWeight}
                                    keyboardType="decimal-pad"
                                    placeholder="185.5"
                                    style={[styles.weightInput, { fontSize: 18, fontWeight: "600" }]}
                                />
                                {previousWeight != null && (
                                    <View style={[styles.prevWeight, { backgroundColor: c.cardElevated }]}>
                                        <Text style={[styles.prevLabel, { color: c.mutedForeground }]}>
                                            Previous
                                        </Text>
                                        <Text style={[styles.prevValue, { color: c.foreground }]}>
                                            {previousWeight}
                                        </Text>
                                    </View>
                                )}
                            </View>
                        </View>

                        {/* Diet Compliance */}
                        <View style={styles.fieldGroup}>
                            <Text style={[styles.label, { color: c.muted }]}>Diet Compliance (1-10)</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
                                {DIET_ENERGY_OPTIONS.map((n) => (
                                    <TouchableOpacity
                                        key={n}
                                        onPress={() => setDietCompliance(dietCompliance === n ? null : n)}
                                        style={[
                                            styles.pickerOption,
                                            {
                                                backgroundColor: dietCompliance === n ? c.primary : c.cardElevated,
                                                borderColor: dietCompliance === n ? c.primary : c.border,
                                            },
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.pickerText,
                                                { color: dietCompliance === n ? c.primaryForeground : c.foreground },
                                            ]}
                                        >
                                            {n}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>

                        {/* Energy Level */}
                        <View style={styles.fieldGroup}>
                            <Text style={[styles.label, { color: c.muted }]}>Energy Level (1-10)</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
                                {DIET_ENERGY_OPTIONS.map((n) => (
                                    <TouchableOpacity
                                        key={n}
                                        onPress={() => setEnergyLevel(energyLevel === n ? null : n)}
                                        style={[
                                            styles.pickerOption,
                                            {
                                                backgroundColor: energyLevel === n ? c.primary : c.cardElevated,
                                                borderColor: energyLevel === n ? c.primary : c.border,
                                            },
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.pickerText,
                                                { color: energyLevel === n ? c.primaryForeground : c.foreground },
                                            ]}
                                        >
                                            {n}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>

                        {/* Notes */}
                        <Input
                            label="Notes"
                            value={notes}
                            onChangeText={setNotes}
                            multiline
                            numberOfLines={4}
                            placeholder="How was your week? Any changes in energy, sleep, hunger?"
                            style={{ minHeight: 100, textAlignVertical: "top" }}
                        />

                        {/* Template Custom Questions */}
                        {questions.length > 0 && (
                            <View style={[styles.templateSection, { borderTopColor: c.border }]}>
                                <Text style={[styles.templateLabel, { color: c.muted }]}>
                                    Additional Questions
                                </Text>
                                {questions.map((q) => (
                                    <CustomQuestionField
                                        key={q.id}
                                        question={q}
                                        value={customResponses[q.id] ?? ""}
                                        onChange={(val) =>
                                            setCustomResponses((prev) => ({ ...prev, [q.id]: val }))
                                        }
                                        colors={c}
                                    />
                                ))}
                            </View>
                        )}

                        {/* Photos */}
                        <View style={styles.fieldGroup}>
                            <Text style={[styles.label, { color: c.muted }]}>
                                Progress Photos ({photos.length}/{MAX_PHOTOS})
                            </Text>
                            <View style={styles.photosRow}>
                                {photos.map((p, idx) => (
                                    <View key={idx} style={styles.photoThumb}>
                                        <Image source={{ uri: p.uri }} style={styles.photoImg} />
                                        <TouchableOpacity
                                            onPress={() => removePhoto(idx)}
                                            style={[styles.photoRemove, { backgroundColor: c.destructive }]}
                                        >
                                            <Text style={styles.photoRemoveText}>✕</Text>
                                        </TouchableOpacity>
                                    </View>
                                ))}
                                {photos.length < MAX_PHOTOS && (
                                    <View style={styles.photoActions}>
                                        <TouchableOpacity
                                            onPress={pickImages}
                                            style={[styles.photoAddBtn, { borderColor: c.border, backgroundColor: c.cardElevated }]}
                                        >
                                            <Text style={[styles.photoAddText, { color: c.muted }]}>📁 Gallery</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            onPress={takePhoto}
                                            style={[styles.photoAddBtn, { borderColor: c.border, backgroundColor: c.cardElevated }]}
                                        >
                                            <Text style={[styles.photoAddText, { color: c.muted }]}>📷 Camera</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}
                            </View>
                        </View>

                        {/* Upload Progress */}
                        {loading && uploadState ? (
                            <View style={styles.uploadIndicator}>
                                <ActivityIndicator size="small" color={c.muted} />
                                <Text style={[styles.uploadText, { color: c.muted }]}>
                                    {uploadState}
                                    {uploadProgress > 0 && uploadProgress < 100
                                        ? ` (${Math.round(uploadProgress)}%)`
                                        : ""}
                                </Text>
                            </View>
                        ) : null}

                        <Button title="Submit Check-In" onPress={onSubmit} loading={loading} disabled={!weight} />
                    </Card>
                </ScrollView>
            </KeyboardAvoidingView>

            {/* Conflict Modal */}
            <Modal visible={conflictVisible} transparent animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalBox, { backgroundColor: c.card }]}>
                        <Text style={[styles.modalTitle, { color: c.foreground }]}>
                            Replace today's check-in?
                        </Text>
                        <Text style={[styles.modalBody, { color: c.muted }]}>
                            You submitted a check-in at {conflictTime}. Do you want to replace it?
                        </Text>
                        <View style={styles.modalButtons}>
                            <Button title="Replace" onPress={handleOverwrite} />
                            <Button title="Cancel" variant="secondary" onPress={handleCancelConflict} />
                        </View>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

/* --- Custom Question Field --- */

function CustomQuestionField({
    question,
    value,
    onChange,
    colors: c,
}: {
    question: TemplateQuestion;
    value: string;
    onChange: (val: string) => void;
    colors: ReturnType<typeof useThemeColors>;
}) {
    const cfg = question.config;

    return (
        <View style={styles.customFieldGroup}>
            <Text style={[styles.label, { color: c.muted }]}>
                {question.label}
                {question.required && <Text style={{ color: c.destructive }}> *</Text>}
            </Text>

            {(question.type === "shortText" || question.type === "longText") && (
                <TextInput
                    value={value}
                    onChangeText={onChange}
                    multiline={question.type === "longText"}
                    numberOfLines={question.type === "longText" ? 3 : 1}
                    style={[
                        styles.customInput,
                        {
                            color: c.foreground,
                            backgroundColor: c.cardElevated,
                            borderColor: c.border,
                            minHeight: question.type === "longText" ? 80 : undefined,
                            textAlignVertical: question.type === "longText" ? "top" : "center",
                        },
                    ]}
                    placeholderTextColor={c.mutedForeground}
                />
            )}

            {question.type === "number" && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <TextInput
                        value={value}
                        onChangeText={onChange}
                        keyboardType="decimal-pad"
                        style={[
                            styles.customInput,
                            { flex: 1, color: c.foreground, backgroundColor: c.cardElevated, borderColor: c.border },
                        ]}
                        placeholderTextColor={c.mutedForeground}
                    />
                    {typeof cfg.unit === "string" && cfg.unit ? (
                        <Text style={{ color: c.muted, fontSize: fontSize.sm }}>{cfg.unit as string}</Text>
                    ) : null}
                </View>
            )}

            {question.type === "boolean" && (
                <View style={{ flexDirection: "row", gap: 8 }}>
                    {["yes", "no"].map((opt) => (
                        <TouchableOpacity
                            key={opt}
                            onPress={() => onChange(value === opt ? "" : opt)}
                            style={[
                                styles.boolBtn,
                                {
                                    backgroundColor: value === opt ? c.primary : c.cardElevated,
                                    borderColor: value === opt ? c.primary : c.border,
                                },
                            ]}
                        >
                            <Text
                                style={{
                                    color: value === opt ? c.primaryForeground : c.foreground,
                                    fontSize: fontSize.sm,
                                    fontWeight: "600",
                                }}
                            >
                                {opt.charAt(0).toUpperCase() + opt.slice(1)}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            )}

            {question.type === "scale" && (() => {
                const min = (cfg.min as number) ?? 1;
                const max = (cfg.max as number) ?? 10;
                const step = (cfg.step as number) ?? 1;
                const options = Array.from(
                    { length: Math.floor((max - min) / step) + 1 },
                    (_, i) => min + i * step
                );
                return (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
                        {options.map((n) => (
                            <TouchableOpacity
                                key={n}
                                onPress={() => onChange(value === String(n) ? "" : String(n))}
                                style={[
                                    styles.pickerOption,
                                    {
                                        backgroundColor: value === String(n) ? c.primary : c.cardElevated,
                                        borderColor: value === String(n) ? c.primary : c.border,
                                    },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.pickerText,
                                        { color: value === String(n) ? c.primaryForeground : c.foreground },
                                    ]}
                                >
                                    {n}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                );
            })()}
        </View>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1 },
    flex: { flex: 1 },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
    fieldGroup: { marginBottom: spacing.md },
    label: {
        fontSize: fontSize.xs,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 6,
    },
    weightRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
    weightInput: { flex: 1 },
    prevWeight: {
        borderRadius: radius.md,
        paddingHorizontal: 12,
        paddingVertical: 8,
        alignItems: "center",
        marginTop: 22,
    },
    prevLabel: { fontSize: fontSize.xs },
    prevValue: { fontSize: fontSize.sm, fontWeight: "600" },
    pickerRow: { gap: 6 },
    pickerOption: {
        width: 36,
        height: 36,
        borderRadius: radius.sm,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    pickerText: { fontSize: fontSize.sm, fontWeight: "600" },
    templateSection: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: spacing.md,
        marginBottom: spacing.md,
    },
    templateLabel: {
        fontSize: fontSize.xs,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: spacing.sm,
    },
    customFieldGroup: { marginBottom: spacing.md },
    customInput: {
        borderRadius: radius.md,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: fontSize.base,
    },
    boolBtn: {
        borderRadius: radius.md,
        borderWidth: 1,
        paddingHorizontal: 20,
        paddingVertical: 10,
    },
    photosRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    photoThumb: { position: "relative" },
    photoImg: { width: 80, height: 80, borderRadius: radius.sm },
    photoRemove: {
        position: "absolute",
        top: -6,
        right: -6,
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    photoRemoveText: { color: "#fff", fontSize: 10, fontWeight: "700" },
    photoActions: { flexDirection: "row", gap: spacing.sm },
    photoAddBtn: {
        borderRadius: radius.sm,
        borderWidth: 1,
        borderStyle: "dashed",
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    photoAddText: { fontSize: fontSize.xs, fontWeight: "500" },
    uploadIndicator: {
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        marginBottom: spacing.md,
    },
    uploadText: { fontSize: fontSize.sm },
    modalOverlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.5)",
        justifyContent: "center",
        alignItems: "center",
        padding: spacing.lg,
    },
    modalBox: {
        width: "100%",
        maxWidth: 340,
        borderRadius: radius.xl,
        padding: spacing.lg,
    },
    modalTitle: { fontSize: fontSize.lg, fontWeight: "700", marginBottom: spacing.sm },
    modalBody: { fontSize: fontSize.sm, lineHeight: 20, marginBottom: spacing.lg },
    modalButtons: { gap: spacing.sm },
});
