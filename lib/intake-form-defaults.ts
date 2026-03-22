export type IntakeFormQuestion = {
    id: string;
    label: string;
    type: "short_text" | "long_text";
    required: boolean;
    placeholder?: string;
    helperText?: string;
};

export type IntakeFormSection = {
    id: string;
    title: string;
    description?: string;
    questions: IntakeFormQuestion[];
};

/** Self-describing answer shape stored in ClientFormSubmission.answers */
export type IntakeAnswersShape = {
    sections: {
        sectionId: string;
        sectionTitle: string;
        answers: {
            questionId: string;
            questionLabel: string;
            value: string;
        }[];
    }[];
    _coachNotes?: string;
    _savedAt?: number;
};

function q(id: string, label: string, type: "short_text" | "long_text", required: boolean, placeholder?: string, helperText?: string): IntakeFormQuestion {
    return { id, label, type, required, ...(placeholder ? { placeholder } : {}), ...(helperText ? { helperText } : {}) };
}

export const DEFAULT_INTAKE_FORM_SECTIONS: IntakeFormSection[] = [
    {
        id: "sec_personal",
        title: "Personal Information",
        description: "Basic details we need on file.",
        questions: [
            q("q_legal_name", "Full Legal Name", "short_text", true, "As it appears on your ID"),
            q("q_dob", "Date of Birth", "short_text", true, "MM/DD/YYYY"),
            q("q_emerg_name", "Emergency Contact Name", "short_text", true),
            q("q_emerg_phone", "Emergency Contact Phone Number", "short_text", true),
        ],
    },
    {
        id: "sec_health",
        title: "Health & Medical",
        description: "This helps us train you safely and effectively.",
        questions: [
            q("q_injuries", "Do you have any injuries or physical limitations?", "long_text", false, "Describe any current or past injuries, surgeries, or areas of chronic pain. Write 'None' if not applicable."),
            q("q_conditions", "Any medical conditions your coach should be aware of?", "long_text", false, "E.g. diabetes, hypertension, asthma. Write 'None' if not applicable."),
            q("q_medications", "Are you currently taking any medications?", "long_text", false, "List any medications that may affect your training or nutrition. Write 'None' if not applicable."),
            q("q_doctor_cleared", "Has your doctor cleared you for exercise?", "short_text", true, "Yes / No / I have not consulted a doctor", "If you have any health concerns, please consult a doctor before beginning a program."),
        ],
    },
    {
        id: "sec_goals",
        title: "Goals & Training",
        description: "Help us understand what you want to achieve.",
        questions: [
            q("q_goal", "What is your primary goal?", "long_text", true, "E.g. lose body fat, build muscle, improve endurance, improve overall health..."),
            q("q_experience", "What is your current training experience level?", "short_text", true, "Beginner / Intermediate / Advanced"),
            q("q_training_days", "How many days per week can you commit to training?", "short_text", true, "E.g. 3, 4, 5 days"),
            q("q_avoid", "Are there any exercises you need to avoid?", "long_text", false, "E.g. no heavy squats due to knee issues. Write 'None' if not applicable."),
            q("q_nutrition", "What does your current nutrition look like?", "long_text", false, "Briefly describe your eating habits, any diets you follow, or write 'No specific approach'."),
        ],
    },
    {
        id: "sec_lifestyle",
        title: "Lifestyle & Commitment",
        description: "Understanding your lifestyle helps us build a realistic program.",
        questions: [
            q("q_occupation", "What is your current occupation?", "short_text", false, "E.g. office worker, nurse, student, stay-at-home parent"),
            q("q_activity", "How would you describe your daily activity level outside of training?", "short_text", false, "Sedentary / Lightly active / Moderately active / Very active"),
            q("q_sleep", "How many hours of sleep do you typically get per night?", "short_text", false, "E.g. 6-7 hours"),
            q("q_anything_else", "Is there anything else you'd like your coach to know?", "long_text", false, "Any context, goals, concerns, or expectations not covered above."),
        ],
    },
];
