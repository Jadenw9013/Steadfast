"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
    href: string;
    label: string;
    icon: React.ReactNode;
    isCheckIn?: boolean;
};

const coachItems: NavItem[] = [
    {
        href: "/coach/dashboard",
        label: "Clients",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        ),
    },
    {
        href: "/coach/messages",
        label: "Messages",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        ),
    },
    {
        href: "/coach/more",
        label: "More",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
        ),
    },
];

// Check-in icon: clipboard with checkmark — consistent stroke style
const CheckInIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <path d="m9 12 2 2 4-4" />
    </svg>
);

const clientItemsWithCoach: NavItem[] = [
    {
        href: "/client",
        label: "Home",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
        ),
    },
    {
        href: "/client/plan",
        label: "Plan",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>
        ),
    },
    {
        href: "/client/check-in",
        label: "Check-In",
        isCheckIn: true,
        icon: <CheckInIcon />,
    },
    {
        href: "/client/messages",
        label: "Messages",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        ),
    },
    {
        href: "/client/profile",
        label: "Profile",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
        ),
    },
];

const clientItemsNoCoach: NavItem[] = [
    {
        href: "/client",
        label: "Home",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
        ),
    },
    {
        href: "/coaches",
        label: "Coaches",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        ),
    },
    {
        href: "/client/check-in",
        label: "Check-In",
        isCheckIn: true,
        icon: <CheckInIcon />,
    },
    {
        href: "/client/messages",
        label: "Messages",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        ),
    },
    {
        href: "/client/profile",
        label: "Profile",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
        ),
    },
];

export function MobileBottomNav({
    role,
    hasCoach,
    checkInOverdue,
}: {
    role: "coach" | "client";
    hasCoach?: boolean;
    checkInOverdue?: boolean;
}) {
    const pathname = usePathname();
    const items =
        role === "coach"
            ? coachItems
            : hasCoach
            ? clientItemsWithCoach
            : clientItemsNoCoach;

    function isActive(href: string) {
        if (href === "/client" && pathname === "/client") return true;
        if (href === "/coach/dashboard" && (pathname === "/coach/dashboard" || pathname.startsWith("/coach/clients"))) return true;
        if (href !== "/client" && href !== "/coach/dashboard" && pathname.startsWith(href)) return true;
        return false;
    }

    return (
        <nav
            className="fixed bottom-0 left-0 right-0 z-30 sm:hidden"
            aria-label="Mobile navigation"
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
            {/* Glass bar — iOS ultra-thin material */}
            <div className="relative border-t border-blue-500/[0.15] bg-black/90 backdrop-blur-2xl" style={{ backdropFilter: "blur(40px) saturate(200%)", WebkitBackdropFilter: "blur(40px) saturate(200%)" }}>
                <div className="flex items-stretch justify-around">
                    {items.map((item) => {
                        const active = isActive(item.href);
                        const isCheckIn = (item as NavItem).isCheckIn;

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                aria-label={item.label}
                                aria-current={active ? "page" : undefined}
                                className={`relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 pb-1 pt-2 text-[10px] font-medium transition-colors ${
                                    active ? "text-white" : "text-zinc-500 hover:text-zinc-300"
                                }`}
                            >
                                {/* Active top indicator */}
                                {active && (
                                    <span className="absolute top-0 left-1/2 h-[2px] w-8 -translate-x-1/2 rounded-full bg-blue-500" />
                                )}

                                {/* Icon — check-in gets a pulsing red dot when overdue */}
                                <span className="relative">
                                    <span className={active ? "text-white" : isCheckIn ? "text-zinc-300" : "text-zinc-500"}>
                                        {item.icon}
                                    </span>
                                    {isCheckIn && checkInOverdue && (
                                        <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5">
                                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                                        </span>
                                    )}
                                </span>

                                <span className={active ? "text-zinc-200" : isCheckIn ? "text-zinc-400" : "text-zinc-500"}>
                                    {item.label}
                                </span>
                            </Link>
                        );
                    })}
                </div>
            </div>
        </nav>
    );
}
