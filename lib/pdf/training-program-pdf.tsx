import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { BlockType } from "@/app/generated/prisma/enums";

const styles = StyleSheet.create({
    page: {
        padding: 40,
        fontFamily: "Helvetica",
        fontSize: 10,
        color: "#18181b",
        backgroundColor: "#ffffff",
    },
    header: {
        marginBottom: 24,
        borderBottomWidth: 1,
        borderBottomColor: "#e4e4e7",
        paddingBottom: 16,
    },
    title: {
        fontSize: 20,
        fontFamily: "Helvetica-Bold",
        marginBottom: 4,
    },
    subtitle: {
        fontSize: 11,
        color: "#71717a",
    },
    coachLine: {
        fontSize: 9,
        color: "#a1a1aa",
        marginTop: 4,
    },
    daySection: {
        marginBottom: 18,
    },
    dayHeader: {
        fontSize: 13,
        fontFamily: "Helvetica-Bold",
        color: "#18181b",
        marginBottom: 3,
    },
    dayGoal: {
        fontSize: 9,
        color: "#71717a",
        fontStyle: "italic" as const,
        marginBottom: 8,
    },
    exerciseRow: {
        flexDirection: "row" as const,
        paddingVertical: 4,
        paddingHorizontal: 4,
    },
    exerciseRowAlt: {
        backgroundColor: "#fafafa",
    },
    exerciseNum: {
        width: 20,
        fontSize: 9,
        color: "#a1a1aa",
        fontFamily: "Helvetica-Bold",
    },
    exerciseName: {
        flex: 1,
        fontSize: 10,
        fontFamily: "Helvetica-Bold",
    },
    exerciseDetails: {
        fontSize: 9,
        color: "#52525b",
        textAlign: "right" as const,
        maxWidth: 200,
    },
    noteRow: {
        paddingVertical: 4,
        paddingHorizontal: 4,
    },
    noteLabel: {
        fontSize: 8,
        fontFamily: "Helvetica-Bold",
        color: "#a1a1aa",
        textTransform: "uppercase" as const,
        letterSpacing: 0.5,
    },
    noteContent: {
        fontSize: 9,
        color: "#52525b",
        marginTop: 2,
    },
    frequencyBanner: {
        marginBottom: 20,
        padding: 10,
        backgroundColor: "#f4f4f5",
        borderRadius: 4,
    },
    frequencyText: {
        fontSize: 10,
        color: "#3f3f46",
    },
    emptyState: {
        textAlign: "center" as const,
        color: "#a1a1aa",
        fontSize: 12,
        marginTop: 60,
    },
    footer: {
        position: "absolute" as const,
        bottom: 30,
        left: 40,
        right: 40,
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        borderTopWidth: 0.5,
        borderTopColor: "#e4e4e7",
        paddingTop: 8,
    },
    footerText: {
        fontSize: 8,
        color: "#a1a1aa",
    },
});

type PdfBlock = {
    type: string;
    title: string;
    content: string;
    sortOrder: number;
};

type PdfDay = {
    dayName: string;
    blocks: PdfBlock[];
};

export type TrainingProgramPdfData = {
    clientName: string;
    coachName?: string;
    coachHeadline?: string;
    weeklyFrequency?: number;
    clientNotes?: string;
    days: PdfDay[];
};

const EXERCISE_TYPES = new Set(["EXERCISE", "SUPERSET", "CARDIO", "ACTIVATION"]);

const BLOCK_LABELS: Record<string, string> = {
    ACTIVATION: "Activation",
    INSTRUCTION: "Note",
    SUPERSET: "Superset",
    CARDIO: "Cardio",
    OPTIONAL: "Optional",
};

export async function renderTrainingProgramPdf(data: TrainingProgramPdfData): Promise<Buffer> {
    return renderToBuffer(<TrainingProgramPdfDocument data={data} />) as Promise<Buffer>;
}

function TrainingProgramPdfDocument({ data }: { data: TrainingProgramPdfData }) {
    const { clientName, coachName, coachHeadline, weeklyFrequency, clientNotes, days } = data;

    const isEmpty = days.length === 0;

    return (
        <Document>
            <Page size="A4" style={styles.page}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.title}>
                        {coachName ? `${coachName}\u2019s Training Program` : "Training Program"}
                    </Text>
                    <Text style={styles.subtitle}>
                        {clientName}
                        {weeklyFrequency ? ` — ${weeklyFrequency}× per week` : ""}
                    </Text>
                    {coachName && (
                        <Text style={styles.coachLine}>
                            Coach: {coachName}{coachHeadline ? ` \u2014 ${coachHeadline}` : ""}
                        </Text>
                    )}
                </View>

                {/* Frequency / notes */}
                {clientNotes && (
                    <View style={styles.frequencyBanner}>
                        <Text style={styles.frequencyText}>{clientNotes}</Text>
                    </View>
                )}

                {/* Content */}
                {isEmpty ? (
                    <Text style={styles.emptyState}>
                        No training program published yet.
                    </Text>
                ) : (
                    days.map((day, dayIndex) => {
                        const goalBlock = day.blocks.find(
                            (b) => b.type === "INSTRUCTION" && b.title?.toLowerCase().includes("goal")
                        );

                        let exerciseNum = 0;

                        return (
                            <View key={dayIndex} style={styles.daySection} wrap={false}>
                                <Text style={styles.dayHeader}>{day.dayName || `Day ${dayIndex + 1}`}</Text>
                                {goalBlock && goalBlock.content && (
                                    <Text style={styles.dayGoal}>Goal: {goalBlock.content}</Text>
                                )}

                                {day.blocks.map((block, blockIndex) => {
                                    // Skip goal blocks — shown in header
                                    if (
                                        block.type === "INSTRUCTION" &&
                                        block.title?.toLowerCase().includes("goal")
                                    ) {
                                        return null;
                                    }

                                    const isExercise = EXERCISE_TYPES.has(block.type) || (!BLOCK_LABELS[block.type] && block.title);
                                    const label = BLOCK_LABELS[block.type];

                                    if (isExercise) {
                                        exerciseNum++;
                                        const details = block.content?.split("\n").filter(Boolean).join(" · ") || "";

                                        return (
                                            <View
                                                key={blockIndex}
                                                style={
                                                    exerciseNum % 2 === 0
                                                        ? [styles.exerciseRow, styles.exerciseRowAlt]
                                                        : styles.exerciseRow
                                                }
                                            >
                                                <Text style={styles.exerciseNum}>{exerciseNum}.</Text>
                                                <Text style={styles.exerciseName}>{block.title || "Unnamed"}</Text>
                                                <Text style={styles.exerciseDetails}>{details}</Text>
                                            </View>
                                        );
                                    }

                                    // Non-exercise block (instruction, note, etc.)
                                    return (
                                        <View key={blockIndex} style={styles.noteRow}>
                                            <Text style={styles.noteLabel}>
                                                {label || "Note"}: {block.title || ""}
                                            </Text>
                                            {block.content && (
                                                <Text style={styles.noteContent}>{block.content}</Text>
                                            )}
                                        </View>
                                    );
                                })}
                            </View>
                        );
                    })
                )}

                {/* Footer */}
                <View style={styles.footer} fixed>
                    <Text style={styles.footerText}>
                        Generated by Steadfast (Beta)
                    </Text>
                    <Text style={styles.footerText}>
                        {new Date().toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                        })}
                    </Text>
                </View>
            </Page>
        </Document>
    );
}
