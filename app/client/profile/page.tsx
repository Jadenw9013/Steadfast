import { getCurrentDbUser } from "@/lib/auth/roles";
import { getProfilePhotoUrl } from "@/lib/supabase/profile-photo-storage";
import { ProfilePhotoUpload } from "@/components/profile/profile-photo-upload";
import { ClientProfileForm } from "@/components/client/client-profile-form";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "My Profile | Steadfast",
};

export default async function ClientProfilePage() {
    const user = await getCurrentDbUser();

    const initials = `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase() || "?";
    const displayName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Client";

    let photoUrl: string | null = null;
    if (user.profilePhotoPath) {
        try {
            photoUrl = await getProfilePhotoUrl(user.profilePhotoPath);
        } catch {
            // Gracefully degrade to initials
        }
    }

    return (
        <div className="mx-auto max-w-2xl pb-12">
            {/* ── Profile Header ── */}
            <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left gap-6 py-8">
                <ProfilePhotoUpload
                    currentPhotoUrl={photoUrl}
                    initials={initials}
                    size="lg"
                />

                <div className="flex-1 min-w-0">
                    <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-3xl">
                        {displayName}
                    </h1>
                    {user.fitnessGoal && (
                        <p className="mt-1 text-base text-zinc-500 dark:text-zinc-400">
                            {user.fitnessGoal}
                        </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                            Client
                        </span>
                    </div>
                </div>
            </div>

            {/* ── Profile Details + Edit ── */}
            <ClientProfileForm
                initialData={{
                    firstName: user.firstName,
                    lastName: user.lastName,
                    clientBio: user.clientBio,
                    fitnessGoal: user.fitnessGoal,
                }}
            />
        </div>
    );
}
