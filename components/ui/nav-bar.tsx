"use client";

import { SignedIn, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RoleSwitcher } from "./role-switcher";

export function NavBar({
  role,
  canSwitchRole,
  hasCoach,
}: {
  role: "coach" | "client";
  canSwitchRole?: boolean;
  hasCoach?: boolean;
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
        { href: "/coach/leads", label: "Leads" },
        { href: "/coach/marketplace/profile", label: "Coaching Profile" },
        { href: "/coach/templates", label: "Templates" },
      ]
      : [
        ...(!hasCoach ? [
          { href: "/coaches", label: "Find a Coach" },
          { href: "/client/saved-coaches", label: "Saved" },
        ] : []),
        { href: "/client/profile", label: "Profile" },
      ];

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.04] bg-[#020815]/80 backdrop-blur-xl">
      <div className={`mx-auto flex h-14 ${maxWidth} items-center justify-between px-4 sm:px-8`}>
        {/* Logo */}
        <Link
          href={homeHref}
          className="group flex items-center gap-2.5"
          aria-label="Steadfast home"
        >
          <div className="relative h-7 w-7 shrink-0 transition-transform duration-200 group-hover:scale-110">
            <Image
              src="/brand/Steadfast_logo_pictoral.png"
              alt=""
              fill
              priority
              className="object-contain brightness-0 dark:brightness-100"
            />
          </div>
          <span className="hidden font-display text-xs font-bold uppercase tracking-[0.25em] text-zinc-100 sm:inline">
            Steadfast
          </span>
        </Link>

        {/* Right side */}
        <nav className="flex items-center gap-0.5 sm:gap-1" aria-label="Main navigation">
          {canSwitchRole && <RoleSwitcher currentRole={role} />}

          {/* Desktop nav links — hidden on mobile */}
          {navLinks.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`hidden rounded-lg px-3 py-1.5 text-sm font-medium transition-colors sm:block ${active
                  ? "bg-white/[0.08] text-white"
                  : "text-zinc-400 hover:bg-white/[0.05] hover:text-white"
                  }`}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            );
          })}

          {/* Settings — desktop only for both roles (bottom nav covers mobile) */}
          <Link
            href={role === "coach" ? "/coach/settings" : "/client/settings"}
            className={`hidden h-8 w-8 items-center justify-center rounded-lg transition-colors sm:flex ${isActive(role === "coach" ? "/coach/settings" : "/client/settings")
              ? "text-white"
              : "text-zinc-500 hover:text-zinc-200"
              }`}
            aria-label="Settings"
            aria-current={isActive(role === "coach" ? "/coach/settings" : "/client/settings") ? "page" : undefined}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </Link>

          {/* Client check-in CTA — desktop only (mobile handled by bottom nav) */}
          {role === "client" && (
            <Link
              href="/client/check-in"
              className={`hidden rounded-lg px-3 py-1.5 text-sm font-semibold transition-all hover:shadow-sm active:scale-[0.97] sm:block dark:shadow-blue-500/20 dark:hover:brightness-110 ${
                isActive("/client/check-in")
                  ? "bg-zinc-100 text-zinc-900 shadow-lg"
                  : "bg-white text-zinc-900 hover:bg-zinc-100"
              }`}
            >
              New Check-In
            </Link>
          )}

          <SignedIn>
            <UserButton />
          </SignedIn>
        </nav>
      </div>
    </header>
  );
}
