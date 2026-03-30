export default function CoachMoreLoading() {
  return (
    <div className="mx-auto max-w-2xl animate-pulse space-y-8 pb-12">
      {/* Profile hero skeleton */}
      <div className="sf-glass-card flex flex-col items-center gap-4 px-6 py-8">
        <div className="h-20 w-20 rounded-full bg-white/[0.06]" />
        <div className="space-y-2 text-center">
          <div className="mx-auto h-5 w-32 rounded bg-white/[0.06]" />
          <div className="mx-auto h-3 w-24 rounded bg-white/[0.04]" />
        </div>
      </div>

      {/* Section rows */}
      {[3, 4, 3].map((count, si) => (
        <div key={si} className="space-y-2">
          <div className="h-3 w-20 rounded bg-white/[0.04]" />
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="sf-glass-card flex items-center gap-4 p-4">
              <div className="h-9 w-9 rounded-xl bg-white/[0.06]" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-28 rounded bg-white/[0.06]" />
                <div className="h-2.5 w-40 rounded bg-white/[0.04]" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
