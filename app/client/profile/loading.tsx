export default function ClientProfileLoading() {
  return (
    <div className="mx-auto max-w-2xl animate-pulse pb-12">
      {/* Profile header */}
      <div className="flex flex-col items-center gap-6 py-8 sm:flex-row sm:items-start">
        <div className="h-24 w-24 rounded-full bg-white/[0.06]" />
        <div className="flex-1 space-y-2 text-center sm:text-left">
          <div className="mx-auto h-7 w-40 rounded bg-white/[0.06] sm:mx-0" />
          <div className="mx-auto h-4 w-28 rounded bg-white/[0.04] sm:mx-0" />
        </div>
      </div>

      {/* Form skeleton */}
      <div className="sf-glass-card space-y-4 p-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 w-20 rounded bg-white/[0.04]" />
            <div className="h-10 w-full rounded-xl bg-white/[0.06]" />
          </div>
        ))}
      </div>

      {/* Navigation rows */}
      <div className="mt-8 space-y-2">
        <div className="h-3 w-16 rounded bg-white/[0.04]" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="sf-glass-card flex items-center gap-4 p-4">
            <div className="h-9 w-9 rounded-xl bg-white/[0.06]" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-24 rounded bg-white/[0.06]" />
              <div className="h-2.5 w-36 rounded bg-white/[0.04]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
