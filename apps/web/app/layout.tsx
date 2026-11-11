import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { Hud } from "@/components/hud";
import { Providers } from "@/components/providers";
import { currentNet, vaultOverview } from "@/lib/data";
import { MODES } from "@/lib/modes";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jb" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: "NullPoint: earn from crypto without betting on it",
  description:
    "Deposit USDC on NEAR. The vault holds a coin and an equal short on Hyperliquid, so price swings cancel and the hourly funding goes to your shares. An AI agent runs it and can't withdraw.",
};

// Before first paint: restore the pause choice and skip the loader on repeat visits.
const boot = `try{var d=document.documentElement.dataset;d.paused=localStorage.getItem("np_paused")==="1"?"1":"0";if(sessionStorage.getItem("np_loaded"))d.loaded="1"}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const net = await currentNet();
  const ov = await vaultOverview(net).catch(() => null);
  const liveMode = ov?.hedge.mode ?? "park";
  return (
    <html lang="en" data-mode={liveMode} data-live={liveMode} className={`${archivo.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <meta name="theme-color" content={MODES[liveMode].f} />
        <script dangerouslySetInnerHTML={{ __html: boot }} />
      </head>
      <body className="min-h-[100dvh]">
        <a href="#main" className="chip sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50">Skip to content</a>
        <Providers network={net.network}>
          <Hud network={net.network} liveMode={liveMode} live={ov ? { symbol: ov.hedge.symbol, delta: ov.hedge.delta, paused: ov.state.paused } : null} />
          <div id="main">{children}</div>
          <footer className="border-t border-tc px-[var(--pad)] py-6 font-mono text-[12px] leading-relaxed">
            NullPoint is an experiment built at NEAR HACKATHON. Testnet uses test USDC and a stand-in for the Intents contract. Mainnet is capped. Not
            investment advice.
          </footer>
        </Providers>
      </body>
    </html>
  );
}

export const viewport: Viewport = { colorScheme: "dark light" };
