import { getCurrentDbUser } from "@/lib/auth/roles";
import { getProfilePhotoUrl } from "@/lib/supabase/profile-photo-storage";
import { ProfilePhotoUpload } from "@/components/profile/profile-photo-upload";
import { ClientProfileForm } from "@/components/client/client-profile-form";
import { Metadata } from "next";
import { ClientTeamBanner } from "@/components/client/ClientTeamBanner";
import Link from "next/link";
import { RoleSwitcher } from "@/components/ui/role-switcher";
import { SignOutButton } from "@clerk/nextjs";

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
                    <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
                        {displayName}
                    </h1>
                    {user.fitnessGoal && (
                        <p className="mt-1 text-base text-zinc-500">
                            {user.fitnessGoal}
                        </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                        <span className="sf-section-label gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                            Client
                        </span>
                    </div>
                </div>
            </div>

            {/* Coach team banner — silent if no team */}
            <ClientTeamBanner clientId={user.id} />

            {/* ── Profile Details + Edit ── */}
            <ClientProfileForm
                initialData={{
                    firstName: user.firstName,
                    lastName: user.lastName,
                    clientBio: user.clientBio,
                    fitnessGoal: user.fitnessGoal,
                }}
            />

            {/* ── Navigation Rows ── */}
            <div className="mt-8 space-y-2">
                <p className="px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Account</p>

                <Link
                    href="/client/settings"
                    className="group flex items-center gap-4 sf-glass-card p-4 transition-all hover:border-white/[0.16]"
                >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-zinc-400">
                        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                            <circle cx="12" cy="12" r="3" />
                        </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-zinc-100">Settings</p>
                        <p className="text-xs text-zinc-500">Notifications and preferences</p>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-600 transition-colors group-hover:text-zinc-400">
                        <path d="m9 18 6-6-6-6" />
                    </svg>
                </Link>

                <Link
                    href="/terms"
                    className="group flex items-center gap-4 sf-glass-card p-4 transition-all hover:border-white/[0.16]"
                >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-zinc-400">
                        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-zinc-100">Terms of Service</p>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-600 transition-colors group-hover:text-zinc-400">
                        <path d="m9 18 6-6-6-6" />
                    </svg>
                </Link>

                <Link
                    href="/privacy"
                    className="group flex items-center gap-4 sf-glass-card p-4 transition-all hover:border-white/[0.16]"
                >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-zinc-400">
                        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-zinc-100">Privacy Policy</p>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-600 transition-colors group-hover:text-zinc-400">
                        <path d="m9 18 6-6-6-6" />
                    </svg>
                </Link>

                {user.isCoach && (
                    <RoleSwitcher currentRole="client" variant="row" />
                )}

                <div className="flex items-center gap-4 sf-glass-card p-4 transition-all hover:border-white/[0.16]">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
                        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-red-400">Sign Out</p>
                    </div>
                    <SignOutButton>
                        <button
                            type="button"
                            className="rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
                        >
                            Sign Out
                        </button>
                    </SignOutButton>
                </div>
            </div>
        </div>
    );
}
