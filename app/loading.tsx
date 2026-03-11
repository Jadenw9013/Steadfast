import Image from "next/image";

export default function RootLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-[#020815]">
      <div className="flex flex-col items-center gap-8">

        {/* Logo — responsive: ~112px mobile, ~144px tablet, ~160px desktop */}
        <div className="relative h-28 w-28 md:h-36 md:w-36 lg:h-40 lg:w-40">
          <Image
            src="/brand/Steadfast_logo_pictoral.png"
            alt="Steadfast"
            fill
            priority
            className="object-contain animate-splash-pulse"
          />
        </div>

        {/* Subtle loading indicator */}
        <div className="flex flex-col items-center gap-2">
          <div className="h-1 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-[#111c30]">
            <div className="h-full w-1/2 animate-splash-bar bg-zinc-900 dark:bg-blue-500" />
          </div>
          <span className="text-sm font-medium tracking-wide text-zinc-500 dark:text-zinc-400">
            Preparing your dashboard
          </span>
        </div>

      </div>
    </div>
  );
}
