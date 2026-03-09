"use client";

import { SignedIn, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RoleSwitcher } from "./role-switcher";
import { ThemeToggle } from "./theme-toggle";

export function NavBar({
  role,
  canSwitchRole,
}: {
  role: "coach" | "client";
  canSwitchRole?: boolean;
}) {
  const pathname = usePathname();
  const maxWidth = role === "coach" ? "max-w-7xl" : "max-w-5xl";
  const homeHref = role === "coach" ? "/coach/dashboard" : "/client";

  function isActive(href: string) {
    if (href === "/client" && pathname === "/client") return true;
    if (href === "/coach/dashboard" && pathname === "/coach/dashboard") return true;
    if (href !== "/client" && href !== "/coach/dashboard" && pathname.startsWith(href)) return true;
    return false;
  }

  const navLinks =
    role === "coach"
      ? [
        { href: "/coach/marketplace/requests", label: "Requests" },
        { href: "/coach/marketplace/profile", label: "Coaching Profile" },
        { href: "/coach/templates", label: "Workout Plans" },
      ]
      : [{ href: "/client/profile", label: "Profile" }];

  return (
    <header className="sticky top-0 z-30 bg-white dark:bg-[#09090b]">
      <div className={`mx-auto flex h-14 ${maxWidth} items-center justify-between px-5 sm:px-8`}>
        {/* Logo */}
        <Link
          href={homeHref}
          className="group flex items-center gap-2.5"
          aria-label="Steadfast home"
        >
          <div className="relative h-7 w-7 transition-transform duration-200 group-hover:scale-110 sm:h-8 sm:w-8">
            <Image
              src="/brand/Steadfast_logo_pictoral.png"
              alt=""
              fill
              priority
              className="object-contain brightness-0 dark:brightness-100"
            />
          </div>
          <span className="hidden font-display text-xs font-bold uppercase tracking-[0.25em] text-gray-900 dark:text-gray-100 sm:inline">
            Steadfast
          </span>
        </Link>

        {/* Right side */}
        <nav className="flex items-center gap-1 sm:gap-1.5" aria-label="Main navigation">
          {canSwitchRole && <RoleSwitcher currentRole={role} />}

          {/* Desktop links */}
          {navLinks.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`hidden rounded-lg px-3 py-1.5 text-sm font-medium transition-colors sm:block ${active
                  ? "bg-gray-900/[0.06] text-gray-900 dark:bg-white/[0.08] dark:text-white"
                  : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                  }`}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            );
          })}

          {/* Settings icon */}
          <Link
            href={role === "coach" ? "/coach/settings" : "/client/settings"}
            className={`hidden h-8 w-8 items-center justify-center rounded-lg transition-colors sm:flex ${isActive(role === "coach" ? "/coach/settings" : "/client/settings")
              ? "text-gray-900 dark:text-white"
              : "text-gray-400 hover:text-gray-700 dark:hover:text-white"
              }`}
            aria-label="Settings"
            aria-current={isActive(role === "coach" ? "/coach/settings" : "/client/settings") ? "page" : undefined}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </Link>

          {/* Client check-in CTA */}
          {role === "client" && (
            <Link
              href="/client/check-in"
              className="rounded-lg bg-gray-900 px-3.5 py-1.5 text-sm font-semibold text-white transition-all hover:bg-gray-800 hover:shadow-sm active:scale-[0.97] dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
            >
              <span className="hidden sm:inline">New Check-In</span>
              <span className="sm:hidden">Check-In</span>
            </Link>
          )}

          <ThemeToggle />

          <SignedIn>
            <UserButton />
          </SignedIn>
        </nav>
      </div>

      {/* Subtle gradient separator */}
      <div className="h-px bg-gradient-to-r from-transparent via-gray-300/60 to-transparent dark:via-gray-700/40" />
    </header>
  );
}
