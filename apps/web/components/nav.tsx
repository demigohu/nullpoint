"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useNearWallet } from "near-connect-hooks";
import type { Network } from "@nullpoint/core";
import { NET_COOKIE } from "@/lib/config";

const LINKS = [
  { href: "/app", label: "Vault" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/proof", label: "Proof" },
];

export function Nav({ network }: { network: Network }) {
  const path = usePathname();
  const router = useRouter();
  const { signedAccountId, signIn, signOut, loading } = useNearWallet();

  const setNet = (n: Network) => {
    document.cookie = `${NET_COOKIE}=${n}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 md:gap-6 md:px-6">
        <Link href="/" className="font-semibold tracking-tight">
          NullPoint
        </Link>
        <div className="hidden gap-5 text-sm text-text-2 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={path === l.href ? "text-text" : "hover:text-text"}>
              {l.label}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2 md:gap-3">
          <div role="group" aria-label="Network" className="flex rounded-control border border-line p-0.5 text-xs">
            {(["testnet", "mainnet"] as const).map((n) => (
              <button
                key={n}
                onClick={() => setNet(n)}
                aria-pressed={network === n}
                className={`rounded-[6px] px-2 py-1 capitalize md:px-2.5 ${network === n ? "bg-surface-2 text-text" : "text-text-3 hover:text-text"}`}
              >
                {n}
              </button>
            ))}
          </div>
          {signedAccountId ? (
            <button onClick={() => signOut()} className="num rounded-control border border-line px-3 py-1.5 text-xs text-text-2 hover:text-text" title="Disconnect">
              {signedAccountId.length > 22 ? `${signedAccountId.slice(0, 10)}…${signedAccountId.slice(-8)}` : signedAccountId}
            </button>
          ) : (
            <button
              onClick={() => signIn()}
              disabled={loading}
              className="rounded-control bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-ink transition active:scale-[0.98] disabled:opacity-60"
            >
              Connect
            </button>
          )}
        </div>
      </nav>
      <div className="flex gap-5 border-t border-line px-4 py-2 text-sm text-text-2 md:hidden">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={path === l.href ? "text-text" : ""}>
            {l.label}
          </Link>
        ))}
      </div>
    </header>
  );
}
