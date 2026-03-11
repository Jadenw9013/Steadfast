import Image from "next/image";

export default function CoachLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-5">
        <div className="relative h-20 w-20 sm:h-24 sm:w-24">
          <Image
            src="/brand/Steadfast_logo_pictoral.png"
            alt=""
            fill
            priority
            className="object-contain animate-splash-pulse"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400 dark:bg-blue-400" />
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400 dark:bg-blue-400" style={{ animationDelay: "150ms" }} />
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400 dark:bg-blue-400" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}
