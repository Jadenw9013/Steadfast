import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Chakra_Petch, Sora } from "next/font/google";
import { Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Footer } from "@/components/footer";
import "./globals.css";

const chakraPetch = Chakra_Petch({
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-chakra",
  subsets: ["latin"],
  display: "swap",
});

const sora = Sora({
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sora",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Steadfast",
  description:
    "Inspired by the call to remain steadfast under trial, Steadfast equips men to build resilient bodies and unwavering discipline through structured coaching and consistent execution.",
  icons: {
    icon: "/brand/Steadfast_logo_pictoral.png",
    apple: "/brand/Steadfast_logo_pictoral.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className="dark" suppressHydrationWarning>
        <body
          className={`${sora.variable} ${chakraPetch.variable} ${geistMono.variable} antialiased bg-[#020815] text-gray-100`}
        >
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-gray-900 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-lg"
          >
            Skip to content
          </a>
          {children}
          <Footer />
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  );
}
