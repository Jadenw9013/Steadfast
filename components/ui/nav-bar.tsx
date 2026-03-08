import { SignedIn, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { RoleSwitcher } from "./role-switcher";

export function NavBar({
  role,
  canSwitchRole,
}: {
  role: "coach" | "client";
  canSwitchRole?: boolean;
}) {
  const maxWidth = role === "coach" ? "max-w-7xl" : "max-w-5xl";
  const homeHref = role === "coach" ? "/coach/dashboard" : "/client";

  const linkStyle =
    "hidden rounded-lg px-3 py-2 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 sm:block";

  const iconBtnStyle =
    "flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:hover:bg-zinc-800 dark:hover:text-zinc-300";

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/60 bg-white/90 backdrop-blur-md dark:border-zinc-800/60 dark:bg-[#09090b]/90">
      <div className={`mx-auto flex h-16 ${maxWidth} items-center justify-between px-5 sm:px-8`}>
        <Link
          href={homeHref}
          className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2"
          aria-label="Steadfast home"
        >
          <div className="relative h-8 w-8 sm:h-9 sm:w-9">
            <Image
              src="/brand/Steadfast_logo_pictoral.png"
              alt=""
              fill
              priority
              className="object-contain"
            />
          </div>
        </Link>
        <nav className="flex items-center gap-1.5 sm:gap-2" aria-label="Main navigation">
          {canSwitchRole && <RoleSwitcher currentRole={role} />}

          {/* ── Coach nav ── */}
          {role === "coach" && (
            <>
              <Link href="/coach/marketplace/requests" className={linkStyle}>
                Requests
              </Link>
              <Link href="/coach/marketplace/profile" className={linkStyle}>
                Coaching Profile
              </Link>
              <Link href="/coach/templates" className={linkStyle}>
                Workout Plans
              </Link>
              <Link href="/coach/settings" className={iconBtnStyle} aria-label="Settings">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </Link>
            </>
          )}

          {/* ── Client nav ── */}
          {role === "client" && (
            <>
              <Link href="/client/profile" className={linkStyle}>
                Profile
              </Link>
              <Link href="/client/settings" className={iconBtnStyle} aria-label="Settings">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </Link>
              <Link
                href="/client/check-in"
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                <span className="hidden sm:inline">New Check-In</span>
                <span className="sm:hidden">Check-In</span>
              </Link>
            </>
          )}
          <SignedIn>
            <UserButton />
          </SignedIn>
        </nav>
      </div>
    </header>
  );
}
