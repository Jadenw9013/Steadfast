import { getTeamInviteByToken } from "@/lib/queries/teams";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { acceptTeamInvite } from "@/app/actions/teams";
import { TeamBadge } from "@/components/ui/TeamBadge";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = { title: "Join Team | Steadfast" };

// ── Layout shell ──────────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black px-5 py-12">
      <div className="w-full max-w-md space-y-6">
        {children}
        <p className="text-center text-xs text-zinc-700">Powered by Steadfast</p>
      </div>
    </div>
  );
}

// Icon presets
function TeamIcon() {
  return (
    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/15">
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
        className="text-blue-400">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    </div>
  );
}

function ErrorIcon() {
  return (
    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800/60">
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
        className="text-zinc-400">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    </div>
  );
}

// ── Reusable error card ───────────────────────────────────────────────────────

function ErrorCard({
  headline,
  body,
  action,
}: {
  headline: string;
  body: string;
  action?: { label: string; href: string };
}) {
  return (
    <PageShell>
      <div className="sf-glass-card p-8 text-center space-y-3">
        <ErrorIcon />
        <h1 className="font-display text-xl font-bold text-zinc-100">{headline}</h1>
        <p className="text-sm text-zinc-400 leading-relaxed">{body}</p>
        {action && (
          <div className="pt-2">
            <Link
              href={action.href}
              className="inline-block rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
            >
              {action.label}
            </Link>
          </div>
        )}
      </div>
    </PageShell>
  );
}

// ── Accept form action ────────────────────────────────────────────────────────

async function AcceptButton({ token, teamName }: { token: string; teamName: string }) {
  async function handleAccept() {
    "use server";
    await acceptTeamInvite(token);
    redirect("/coach/settings?joined=true");
  }

  return (
    <form action={handleAccept}>
      <button
        type="submit"
        className="block w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition-all hover:bg-blue-500 active:scale-[0.98]"
      >
        Join {teamName}
      </button>
    </form>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function TeamInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await getTeamInviteByToken(token);

  // ── Invalid token ──
  if (!invite) {
    return (
      <ErrorCard
        headline="This invite link is invalid"
        body="The link you followed doesn't match any active team invite. Double-check the URL or ask your head coach for a new one."
        action={{ label: "Browse coaches", href: "/coaches" }}
      />
    );
  }

  // ── Expired ──
  const isExpired = invite.status !== "PENDING" || invite.expiresAt < new Date();
  if (isExpired) {
    return (
      <ErrorCard
        headline="This invite has expired"
        body="This invite link is no longer valid. Contact your head coach and ask them to generate a new link from their team settings."
      />
    );
  }

  // Check auth
  const { userId: clerkId } = await auth();
  let dbUser: Awaited<ReturnType<typeof getCurrentDbUser>> | null = null;
  if (clerkId) {
    try { dbUser = await getCurrentDbUser(); } catch { /* not yet in DB */ }
  }

  const signInUrl = `/sign-in?redirect_url=${encodeURIComponent(`/invite/team/${token}`)}`;

  // ── Not authenticated ──
  if (!dbUser) {
    return (
      <PageShell>
        <div className="sf-glass-card p-8 text-center space-y-5">
          <TeamIcon />
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">You&apos;re invited to join</p>
            <h1 className="font-display text-2xl font-bold text-zinc-100">{invite.team.name}</h1>
          </div>
          <div className="flex justify-center">
            <TeamBadge teamName={invite.team.name} logoPath={invite.team.logoPath} size="md" />
          </div>
          <p className="text-sm text-zinc-400">Sign in with your Steadfast coach account to accept this invite.</p>
          <div className="space-y-2 pt-1">
            <Link
              href={signInUrl}
              className="block w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              Sign in to join →
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  // ── Not a coach ──
  if (!dbUser.isCoach) {
    return (
      <ErrorCard
        headline="This invite is for coaches only"
        body="Only Steadfast coaches can join a team. If you're a client, your coach manages their team separately."
      />
    );
  }

  // ── Already on a team ──
  if (dbUser.teamId) {
    return (
      <ErrorCard
        headline="You're already on a team"
        body="Leave your current team in settings before joining a new one."
        action={{ label: "Go to Settings", href: "/coach/settings" }}
      />
    );
  }

  // ── Valid — show join CTA ──
  return (
    <PageShell>
      <div className="sf-glass-card p-8 text-center space-y-6">
        {/* Team logo / badge */}
        <div className="space-y-4">
          <TeamIcon />
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1">
              {invite.team.name} is inviting you
            </p>
            <h1 className="font-display text-2xl font-bold text-zinc-100">Join {invite.team.name}</h1>
          </div>
          <div className="flex justify-center">
            <TeamBadge teamName={invite.team.name} logoPath={invite.team.logoPath} size="md" />
          </div>
        </div>

        <p className="text-sm text-zinc-400 leading-relaxed">
          You&apos;ve been invited to join this coaching team on Steadfast.
          <br />
          <span className="text-zinc-500 text-xs">You&apos;ll join as a Coach. Your head coach can update your role.</span>
        </p>

        <div className="space-y-3">
          <AcceptButton token={token} teamName={invite.team.name} />
          <Link
            href="/coach/dashboard"
            className="block w-full rounded-xl border border-zinc-800 py-3 text-sm font-medium text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-300"
          >
            Maybe later
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
