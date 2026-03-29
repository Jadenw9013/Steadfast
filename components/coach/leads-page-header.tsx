"use client";

import { useState } from "react";

import { AddLeadForm } from "./add-lead-form";

export function LeadsPageHeader() {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Leads</h1>
          <p className="mt-1 text-sm text-zinc-500">Manage your coaching pipeline</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Invite Client — primary gradient */}
          <a
            href="/coach/clients/invite"
            className="sf-button-primary flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0f1e] active:scale-[0.97]"
            style={{ minHeight: "44px" }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" x2="19" y1="8" y2="14" /><line x1="22" x2="16" y1="11" y2="11" /></svg>
            Invite Client
          </a>

          {/* Add Lead — secondary outlined */}
          {!addOpen && (
            <button
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-zinc-800 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-all hover:border-white/[0.14] hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0f1e] active:scale-[0.97]"
              style={{ minHeight: "44px" }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" x2="19" y1="8" y2="14" /><line x1="22" x2="16" y1="11" y2="11" /></svg>
              Add Lead
            </button>
          )}
        </div>
      </div>

      {/* Expandable add-lead form */}
      {addOpen && (
        <div className="animate-fade-in rounded-2xl border border-blue-500/20 bg-[#0d1829] p-5">
          {/* Blue left accent bar */}
          <div className="flex gap-4">
            <div className="w-1 shrink-0 rounded-full bg-blue-500/60" />
            <div className="flex-1">
              <AddLeadForm onClose={() => setAddOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
