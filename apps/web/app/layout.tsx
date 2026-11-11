import type { Metadata } from "next";
import localFont from "next/font/local";
import { Nav } from "@/components/nav";
import { Providers } from "@/components/providers";
import { currentNet } from "@/lib/data";
import "./globals.css";

const geistSans = localFont({ src: "./fonts/GeistVF.woff", variable: "--font-geist-sans" });
const geistMono = localFont({ src: "./fonts/GeistMonoVF.woff", variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "NullPoint",
  description: "A delta-neutral USDC vault on NEAR. Spot held through NEAR Intents, hedged on Hyperliquid, controlled by a contract the keeper can't drain.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const net = await currentNet();
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-[100dvh]`}>
        <Providers network={net.network}>
          <Nav network={net.network} />
          {children}
          <footer className="mx-auto mt-24 max-w-7xl border-t border-line px-4 py-8 text-sm text-text-3 md:px-6">
            NullPoint is an experiment built at NEAR HACKATHON. Testnet uses mock USDC and a mock Intents verifier; mainnet
            is capped. Not investment advice.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
