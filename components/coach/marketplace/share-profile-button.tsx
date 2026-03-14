"use client";

import { useState } from "react";

export function ShareProfileButton({ slug }: { slug: string }) {
    const [copied, setCopied] = useState(false);
    const [open, setOpen] = useState(false);

    const profileUrl =
        typeof window !== "undefined"
            ? `${window.location.origin}/coaches/${slug}`
            : `/coaches/${slug}`;

    async function copyLink() {
        try {
            await navigator.clipboard.writeText(profileUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback: select all in the input
        }
    }

    return (
        <>
            {/* Trigger button */}
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="group flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2.5 text-sm font-semibold text-blue-400 transition-all duration-200 hover:border-blue-500/60 hover:bg-blue-500/20 hover:text-blue-300 hover:shadow-md hover:shadow-blue-500/10 active:scale-[0.97]"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-transform duration-200 group-hover:rotate-12"
                >
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                Share Profile
            </button>

            {/* Modal overlay */}
            {open && (
                <div
                    className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
                    aria-modal="true"
                    role="dialog"
                    aria-label="Share your profile"
                >
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        onClick={() => setOpen(false)}
                    />

                    {/* Panel */}
                    <div className="relative z-10 w-full max-w-md rounded-t-3xl border border-white/[0.08] bg-[#0d1428] p-6 shadow-2xl shadow-black/60 sm:rounded-2xl">
                        {/* Close */}
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-300"
                            aria-label="Close"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                        </button>

                        {/* Header */}
                        <div className="mb-5 flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
                                    <circle cx="18" cy="5" r="3" />
                                    <circle cx="6" cy="12" r="3" />
                                    <circle cx="18" cy="19" r="3" />
                                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                                </svg>
                            </div>
                            <div>
                                <p className="text-base font-bold text-zinc-100">Share Your Profile</p>
                                <p className="text-xs text-zinc-500">Send this link to potential clients</p>
                            </div>
                        </div>

                        {/* URL row */}
                        <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-1 pl-4">
                            <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">{profileUrl}</span>
                            <button
                                type="button"
                                onClick={copyLink}
                                className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                                    copied
                                        ? "bg-emerald-500/20 text-emerald-400"
                                        : "bg-blue-500 text-white hover:bg-blue-400 active:scale-[0.96]"
                                }`}
                            >
                                {copied ? (
                                    <span className="flex items-center gap-1.5">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                                        Copied!
                                    </span>
                                ) : "Copy Link"}
                            </button>
                        </div>

                        {/* Divider */}
                        <div className="my-5 flex items-center gap-3">
                            <div className="h-px flex-1 bg-white/[0.06]" />
                            <span className="text-[11px] font-medium text-zinc-600">or share via</span>
                            <div className="h-px flex-1 bg-white/[0.06]" />
                        </div>

                        {/* Share targets */}
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                {
                                    label: "WhatsApp",
                                    href: `https://wa.me/?text=${encodeURIComponent(`Check out my coaching profile: ${profileUrl}`)}`,
                                    icon: (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-emerald-400">
                                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                                            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.122 1.532 5.852L.057 23.57a.5.5 0 0 0 .613.612l5.766-1.491A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.9a9.885 9.885 0 0 1-5.031-1.37l-.36-.214-3.732.966.994-3.638-.235-.374A9.862 9.862 0 0 1 2.1 12C2.1 6.532 6.532 2.1 12 2.1S21.9 6.532 21.9 12 17.468 21.9 12 21.9z"/>
                                        </svg>
                                    ),
                                },
                                {
                                    label: "Email",
                                    href: `mailto:?subject=${encodeURIComponent("My Coaching Profile")}&body=${encodeURIComponent(`Check out my coaching profile on Steadfast:\n${profileUrl}`)}`,
                                    icon: (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
                                            <rect width="20" height="16" x="2" y="4" rx="2"/>
                                            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                                        </svg>
                                    ),
                                },
                                {
                                    label: "SMS",
                                    href: `sms:?body=${encodeURIComponent(`Check out my coaching profile: ${profileUrl}`)}`,
                                    icon: (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-violet-400">
                                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                        </svg>
                                    ),
                                },
                            ].map(({ label, href, icon }) => (
                                <a
                                    key={label}
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex flex-col items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] py-3.5 text-xs font-medium text-zinc-400 transition-all hover:border-white/[0.12] hover:bg-white/[0.07] hover:text-zinc-200"
                                >
                                    {icon}
                                    {label}
                                </a>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
