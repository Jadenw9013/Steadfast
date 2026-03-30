import Link from "next/link";
import Image from "next/image";

export function Footer() {
    return (
        <footer className="border-t border-white/[0.08] bg-black">
            <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 py-10 sm:flex-row sm:justify-between sm:px-8">
                <div className="flex items-center gap-3">
                    <div className="relative h-5 w-5 opacity-40">
                        <Image
                            src="/brand/Steadfast_logo_pictoral.png"
                            alt=""
                            fill
                            className="object-contain brightness-0 invert"
                        />
                    </div>
                    <span className="text-xs text-zinc-500">
                        &copy; {new Date().getFullYear()} Steadfast
                    </span>
                    <span className="rounded-full border border-white/[0.12] px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                        Beta
                    </span>
                </div>
                <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-zinc-500" aria-label="Footer navigation">
                    <Link href="/about" className="transition-colors hover:text-zinc-300">
                        About
                    </Link>
                    <span className="text-white/[0.12]" aria-hidden="true">&middot;</span>
                    <Link href="/privacy" className="transition-colors hover:text-zinc-300">
                        Privacy Policy
                    </Link>
                    <span className="text-white/[0.12]" aria-hidden="true">&middot;</span>
                    <Link href="/terms" className="transition-colors hover:text-zinc-300">
                        Terms of Service
                    </Link>
                    <span className="text-white/[0.12]" aria-hidden="true">&middot;</span>
                    <Link href="/sms-policy" className="transition-colors hover:text-zinc-300">
                        SMS Policy
                    </Link>
                    <span className="text-white/[0.12]" aria-hidden="true">&middot;</span>
                    <Link href="/sign-in" className="transition-colors hover:text-zinc-300">
                        Sign In
                    </Link>
                </nav>
            </div>
        </footer>
    );
}
