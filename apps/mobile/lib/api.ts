import * as SecureStore from "expo-secure-store";

const BASE_URL =
    process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:3000";

const TIMEOUT_MS = 15000;

async function getToken(): Promise<string | null> {
    try {
        return await SecureStore.getItemAsync("clerk_token");
    } catch {
        return null;
    }
}

export class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.name = "ApiError";
        this.status = status;
    }
}

export class NetworkError extends Error {
    constructor(message = "Network request failed. Please check your connection.") {
        super(message);
        this.name = "NetworkError";
    }
}

export async function api<T = unknown>(
    path: string,
    options: RequestInit = {}
): Promise<T> {
    const token = await getToken();
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string>),
    };
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(`${BASE_URL}${path}`, {
            ...options,
            headers,
            signal: controller.signal,
        });

        if (res.status === 401) {
            throw new ApiError("Session expired. Please sign in again.", 401);
        }

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new ApiError(
                body.error || `Request failed (${res.status})`,
                res.status
            );
        }

        return res.json() as Promise<T>;
    } catch (err) {
        if (err instanceof ApiError) throw err;
        if (
            err instanceof TypeError ||
            (err instanceof DOMException && err.name === "AbortError")
        ) {
            throw new NetworkError();
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

export const apiGet = <T = unknown>(path: string) => api<T>(path);

export const apiPost = <T = unknown>(path: string, body: unknown) =>
    api<T>(path, { method: "POST", body: JSON.stringify(body) });

export const apiPatch = <T = unknown>(path: string, body?: unknown) =>
    api<T>(path, {
        method: "PATCH",
        body: body ? JSON.stringify(body) : undefined,
    });

export const apiDelete = <T = unknown>(path: string, body?: unknown) =>
    api<T>(path, {
        method: "DELETE",
        body: body ? JSON.stringify(body) : undefined,
    });
