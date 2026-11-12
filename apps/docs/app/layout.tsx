import type { Metadata } from "next";
import Link from "next/link";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import { APP_URL, REPO_URL } from "@/lib/nav";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jb" });

export const metadata: Metadata = {
  title: { default: "NullPoint docs", template: "%s · NullPoint docs" },
  description: "How NullPoint works, how it's built, what it trusts, and how to check every claim yourself.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-mode="btc" className={`${archivo.variable} ${mono.variable}`}>
      <body className="min-h-[100dvh]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-tc p-[var(--pad)]">
          <Link href="/" className="text-[17px]">
            <span className="wdth-112"><span className="font-normal">null</span><span className="font-extrabold">Point</span></span>
            <span className="ml-2 font-mono text-[12px] uppercase tracking-[0.2em]">docs</span>
          </Link>
          <div className="flex gap-2">
            <a href={REPO_URL} className="btn btn-ghost max-sm:hidden" data-label="GitHub">GitHub</a>
            <a href={APP_URL} className="btn" data-label="Open the app">Open the app</a>
          </div>
        </header>
        <div className="grid gap-[var(--pad)] p-[var(--pad)] lg:grid-cols-[14rem_1fr]">
          <aside className="min-w-0 lg:sticky lg:top-[var(--pad)] lg:self-start">
            <Sidebar />
          </aside>
          <main className="min-w-0 pb-24">{children}</main>
        </div>
      </body>
    </html>
  );
}
