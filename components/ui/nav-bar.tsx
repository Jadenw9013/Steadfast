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
        { href: "/coach/messages", label: "Messages" },
        { href: "/coach/more", label: "More" },
      ]
      : [
        ...(!hasCoach ? [
          { href: "/coaches", label: "Find a Coach" },
        ] : []),
        { href: "/client/plan", label: "Plan" },
        { href: "/client/messages", label: "Messages" },
        { href: "/client/profile", label: "Profile" },
      ];

  return (
    <header
      className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#0a0a0b]/80 backdrop-blur-2xl"
      style={{
        backdropFilter: "blur(40px) saturate(180%)",
        WebkitBackdropFilter: "blur(40px) saturate(180%)",
      }}
    >
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
              className="object-contain brightness-0 invert"
            />
          </div>
          <span className="hidden font-display text-[11px] font-bold uppercase tracking-[0.3em] text-zinc-200 sm:inline">
            Steadfast
          </span>
        </Link>

        {/* Right side */}
        <nav className="flex items-center gap-1 sm:gap-1.5" aria-label="Main navigation">
          {canSwitchRole && <RoleSwitcher currentRole={role} />}

          {/* Desktop nav links — hidden on mobile */}
          {navLinks.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`hidden rounded-lg px-3.5 py-1.5 text-[13px] font-medium tracking-wide transition-all duration-150 sm:block ${active
                  ? "bg-white/[0.10] text-white shadow-sm"
                  : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
                  }`}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            );
          })}

          {/* Client check-in CTA — desktop only (mobile handled by bottom nav) */}
          {role === "client" && (
            <Link
              href="/client/check-in"
              className={`hidden rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:block ${
                isActive("/client/check-in")
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/25"
                  : "bg-blue-600 text-white hover:bg-blue-500 shadow-sm shadow-blue-600/20"
              }`}
            >
              Check-In
            </Link>
          )}

          {/* Divider before avatar */}
          <div className="mx-1 hidden h-5 w-px bg-white/[0.08] sm:block" aria-hidden="true" />

          <SignedIn>
            <UserButton />
          </SignedIn>
        </nav>
      </div>
    </header>
  );
}
