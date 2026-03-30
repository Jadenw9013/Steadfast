export default function CoachDashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse space-y-6 px-4 pb-12 sm:px-6">
      {/* Header */}
      <div className="space-y-1 py-4">
        <div className="h-7 w-48 rounded bg-white/[0.06]" />
        <div className="h-4 w-32 rounded bg-white/[0.04]" />
      </div>

      {/* Client cards grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="sf-glass-card space-y-3 p-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-white/[0.06]" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-28 rounded bg-white/[0.06]" />
                <div className="h-2.5 w-20 rounded bg-white/[0.04]" />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="h-3 w-full rounded bg-white/[0.04]" />
              <div className="h-3 w-3/4 rounded bg-white/[0.04]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
