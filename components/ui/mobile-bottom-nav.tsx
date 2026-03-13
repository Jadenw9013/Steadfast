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
        label: "Home",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
        ),
    },
    {
        href: "/coach/marketplace/requests",
        label: "Requests",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
        ),
    },
    {
        href: "/coach/marketplace/profile",
        label: "Profile",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
        ),
    },
    {
        href: "/coach/templates",
        label: "Plans",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
        ),
    },
    {
        href: "/coach/settings",
        label: "Settings",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
        ),
    },
];

const clientItems: NavItem[] = [
    {
        href: "/client",
        label: "Home",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
        ),
    },
    {
        href: "/client/profile",
        label: "Profile",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
        ),
    },
    {
        href: "/client/check-in",
        label: "Check-In",
        isCheckIn: true,
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        ),
    },
    {
        href: "/client/settings",
        label: "Settings",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
        ),
    },
];

export function MobileBottomNav({ role, hasCoach }: { role: "coach" | "client"; hasCoach?: boolean }) {
    const pathname = usePathname();
    const allItems = role === "coach" ? coachItems : clientItems;
    // Hide "Coaches" tab when client has a coach — already removed from clientItems based on hasCoach requirement
    const items = (role === "client" && !hasCoach)
        ? [
            clientItems[0], // Home
            { href: "/coaches", label: "Coaches", icon: (<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>) },
            clientItems[1], // Profile
            clientItems[2], // Check-In
            clientItems[3], // Settings
        ]
        : allItems;

    function isActive(href: string) {
        if (href === "/client" && pathname === "/client") return true;
        if (href === "/coach/dashboard" && pathname === "/coach/dashboard") return true;
        if (href !== "/client" && href !== "/coach/dashboard" && pathname.startsWith(href)) return true;
        return false;
    }

    return (
        <nav
            className="fixed bottom-0 left-0 right-0 z-30 sm:hidden"
            aria-label="Mobile navigation"
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
            {/* Glass bar */}
            <div className="relative border-t border-white/[0.06] bg-[#020815]/90 backdrop-blur-xl">
                <div className="flex items-stretch justify-around">
                    {items.map((item) => {
                        const active = isActive(item.href);
                        const isCheckIn = (item as NavItem).isCheckIn;

                        if (isCheckIn) {
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    aria-label="Check-In"
                                    aria-current={active ? "page" : undefined}
                                    className="relative flex flex-1 flex-col items-center justify-center py-2"
                                >
                                    {/* Floating pill — same height as other tabs but visually distinct */}
                                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 ${
                                        active
                                            ? "bg-blue-500 shadow-lg shadow-blue-500/40"
                                            : "bg-blue-600/80 shadow-md shadow-blue-600/20 hover:bg-blue-500"
                                    }`}>
                                        <span className="text-white">{item.icon}</span>
                                    </div>
                                    <span className={`mt-1 text-[9px] font-bold uppercase tracking-wider ${active ? "text-blue-400" : "text-blue-400/60"}`}>
                                        {item.label}
                                    </span>
                                </Link>
                            );
                        }

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 pb-1 pt-2 text-[10px] font-medium transition-colors ${
                                    active ? "text-white" : "text-zinc-500 hover:text-zinc-300"
                                }`}
                                aria-current={active ? "page" : undefined}
                            >
                                {/* Active top indicator */}
                                {active && (
                                    <span className="absolute top-0 left-1/2 h-[2px] w-8 -translate-x-1/2 rounded-full bg-blue-500" />
                                )}
                                <span className={active ? "text-white" : "text-zinc-500"}>{item.icon}</span>
                                <span className={active ? "text-zinc-200" : "text-zinc-500"}>{item.label}</span>
                            </Link>
                        );
                    })}
                </div>
            </div>
        </nav>
    );
}
