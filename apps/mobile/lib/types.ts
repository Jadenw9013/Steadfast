export interface User {
    id: string;
    clerkId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    activeRole: "CLIENT" | "COACH";
    isCoach: boolean;
    isClient: boolean;
    coachCode: string | null;
    timezone: string | null;
}

export interface CheckInLight {
    id: string;
    weekOf: string;
    weight: number | null;
    status: "SUBMITTED" | "REVIEWED";
    notes: string | null;
    createdAt: string;
    submittedAt: string;
    localDate: string | null;
    _count: { photos: number };
}

export interface CheckInDetail {
    id: string;
    weekOf: string;
    weight: number | null;
    dietCompliance: number | null;
    energyLevel: number | null;
    status: "SUBMITTED" | "REVIEWED";
    notes: string | null;
    submittedAt: string;
    localDate: string | null;
    customResponses: unknown;
    templateSnapshot: unknown;
    client: {
        id: string;
        firstName: string | null;
        lastName: string | null;
    };
    photos: {
        id: string;
        storagePath: string;
        url: string;
        sortOrder: number;
    }[];
}

export interface MealPlanItem {
    mealName: string;
    foodName: string;
    quantity: string;
    unit: string;
    servingDescription: string | null;
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
    sortOrder: number;
}

export interface MealPlan {
    id: string;
    weekOf: string;
    version: number;
    status: string;
    publishedAt: string | null;
    items: MealPlanItem[];
}

export interface Message {
    id: string;
    body: string;
    createdAt: string;
    sender: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        activeRole: string;
    };
}

export interface CoachClient {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    weekStatus: "new" | "reviewed" | "missing";
    hasClientMessage: boolean;
    checkInId: string | null;
    weight: number | null;
    weightChange: number | null;
    dietCompliance: number | null;
    energyLevel: number | null;
    submittedAt: string | null;
}

export interface ClientDashboard {
    role: "CLIENT";
    user: { id: string; firstName: string | null; lastName: string | null };
    coach: { firstName: string | null; lastName: string | null } | null;
    checkIns: CheckInLight[];
    mealPlan: MealPlan | null;
    latestCoachMessage: {
        body: string;
        createdAt: string;
        weekOf: string;
    } | null;
    weightHistory: { date: string; weight: number }[];
}

export interface CoachDashboard {
    role: "COACH";
    user: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        coachCode: string | null;
    };
    clients: CoachClient[];
}

export type DashboardData = ClientDashboard | CoachDashboard;
