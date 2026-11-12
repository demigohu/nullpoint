import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { source } from "@/lib/source";
import { APP_URL, REPO_URL, STATUS_URL } from "@/lib/vault";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jb" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_DOCS_URL ?? "http://localhost:3001"),
  title: { default: "NullPoint docs", template: "%s · NullPoint docs" },
  description: "What NullPoint is, how it earns, how it's built, what it trusts, and how to check every claim yourself.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    // Fixed to the BTC duotone (orange on black): the docs don't follow the vault's live coin.
    <html lang="en" data-mode="btc" className={`dark ${archivo.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider theme={{ forcedTheme: "dark", enableSystem: false }}>
          <DocsLayout
            tree={source.getPageTree()}
            nav={{
              title: (
                <span className="text-[17px]">
                  <span className="wdth-112"><span className="font-normal">null</span><span className="font-extrabold">Point</span></span>
                  <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.2em]">docs</span>
                </span>
              ),
            }}
            githubUrl={REPO_URL}
            links={[
              { text: "Open the app", url: APP_URL, external: true },
              { text: "Status", url: STATUS_URL, external: true },
            ]}
            themeSwitch={{ enabled: false }}
          >
            {children}
          </DocsLayout>
        </RootProvider>
      </body>
    </html>
  );
}
