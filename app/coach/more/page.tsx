import { getCurrentDbUser } from "@/lib/auth/roles";
import { getProfilePhotoUrl } from "@/lib/supabase/profile-photo-storage";
import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { RoleSwitcher } from "@/components/ui/role-switcher";

function MoreRow({
  href,
  icon,
  title,
  subtitle,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 sf-glass-card p-4 transition-all hover:border-white/[0.16]"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-zinc-400">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-100">{title}</p>
        <p className="text-xs text-zinc-500">{subtitle}</p>
      </div>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-zinc-500 transition-colors group-hover:text-zinc-300"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </Link>
  );
}

export default async function CoachMorePage() {
  const user = await getCurrentDbUser();

  const displayName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Coach";
  const initials = `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase() || "?";

  let photoUrl: string | null = null;
  if (user.profilePhotoPath) {
    try {
      photoUrl = await getProfilePhotoUrl(user.profilePhotoPath);
    } catch {
      // degrade gracefully to initials
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 pb-12">
      {/* ── Profile Hero ── */}
      <div className="sf-glass-card flex flex-col items-center gap-4 px-6 py-8 text-center">
        <div
          className="h-20 w-20 rounded-full p-[2px]"
          style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)" }}
        >
          {photoUrl ? (
            <img src={photoUrl} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-full bg-[#111c30] text-xl font-bold text-zinc-100">
              {initials}
            </div>
          )}
        </div>
        <div>
          <p className="text-lg font-bold text-white">{displayName}</p>
          <p className="text-sm text-zinc-500">Coach account</p>
        </div>
      </div>

      {/* ── App Settings ── */}
      <section className="space-y-2">
        <p className="px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">App Settings</p>
        <MoreRow
          href="/coach/marketplace/profile"
          title="Profile"
          subtitle="Edit your public coaching profile"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          }
        />
        <MoreRow
          href="/coach/settings"
          title="Coach Settings"
          subtitle="Notifications and preferences"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          }
        />
      </section>

      {/* ── Workspace ── */}
      <section className="space-y-2">
        <p className="px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Workspace</p>
        <MoreRow
          href="/coach/clients/invite"
          title="Invite Client"
          subtitle="Send a direct invite link to a client"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <line x1="19" x2="19" y1="8" y2="14"/>
              <line x1="22" x2="16" y1="11" y2="11"/>
            </svg>
          }
        />
        <MoreRow
          href="/coach/leads"
          title="Leads Pipeline"
          subtitle="Manage coaching inquiries"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          }
        />
        <MoreRow
          href="/coach/templates"
          title="Templates"
          subtitle="Meal plan and workout templates"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          }
        />
      </section>

      {/* ── Account ── */}
      <section className="space-y-2">
        <p className="px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Account</p>

        {user.isClient && (
          <div className="flex items-center gap-4 sf-glass-card p-4 transition-all hover:border-white/[0.16]">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-zinc-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-zinc-100">Switch to Client</p>
              <p className="text-xs text-zinc-500">View your client dashboard</p>
            </div>
            <RoleSwitcher currentRole="coach" />
          </div>
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
      </section>
    </div>
  );
}
