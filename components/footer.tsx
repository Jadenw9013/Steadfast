import Link from "next/link";
import Image from "next/image";

export function Footer() {
    return (
        <footer className="border-t border-zinc-200/60 dark:border-zinc-800/60">
            <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 py-10 sm:flex-row sm:justify-between sm:px-8">
                <div className="flex items-center gap-3">
                    <div className="relative h-5 w-5 opacity-40">
                        <Image
                            src="/brand/Steadfast_logo_pictoral.png"
                            alt=""
                            fill
                            className="object-contain"
                        />
                    </div>
                    <span className="text-xs text-zinc-400">
                        &copy; {new Date().getFullYear()} Steadfast
                    </span>
                    <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] font-medium text-zinc-400 dark:border-zinc-700">
                        Beta
                    </span>
                </div>
                <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-zinc-400" aria-label="Footer navigation">
                    <Link href="/about" className="transition-colors hover:text-zinc-600 dark:hover:text-zinc-300">
                        About
                    </Link>
                    <span className="text-zinc-300 dark:text-zinc-700" aria-hidden="true">&middot;</span>
                    <Link href="/privacy" className="transition-colors hover:text-zinc-600 dark:hover:text-zinc-300">
                        Privacy Policy
                    </Link>
                    <span className="text-zinc-300 dark:text-zinc-700" aria-hidden="true">&middot;</span>
                    <Link href="/terms" className="transition-colors hover:text-zinc-600 dark:hover:text-zinc-300">
                        Terms of Service
                    </Link>
                    <span className="text-zinc-300 dark:text-zinc-700" aria-hidden="true">&middot;</span>
                    <Link href="/sms-policy" className="transition-colors hover:text-zinc-600 dark:hover:text-zinc-300">
                        SMS Policy
                    </Link>
                    <span className="text-zinc-300 dark:text-zinc-700" aria-hidden="true">&middot;</span>
                    <Link href="/sign-in" className="transition-colors hover:text-zinc-600 dark:hover:text-zinc-300">
                        Sign In
                    </Link>
                </nav>
            </div>
        </footer>
    );
}
