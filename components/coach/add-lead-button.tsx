"use client";

import { useState, useRef } from "react";
import { AddLeadForm } from "./add-lead-form";

export function AddLeadButton() {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);

    if (open) {
        return (
            <AddLeadForm onClose={() => {
                setOpen(false);
                setTimeout(() => buttonRef.current?.focus(), 0);
            }} />
        );
    }

    return (
        <button
            ref={buttonRef}
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-all hover:border-zinc-500 hover:text-zinc-100"
            style={{ minHeight: "44px" }}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>
            Add Lead
        </button>
    );
}
