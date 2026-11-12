"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PAGES } from "@/lib/nav";

export function Sidebar() {
  const path = usePathname();
  return (
    <nav aria-label="Docs" className="flex gap-1 overflow-x-auto overscroll-x-contain lg:flex-col lg:overflow-visible">
      {PAGES.map((p) => (
        <Link key={p.href} href={p.href} aria-current={path === p.href ? "page" : undefined}
          className={`shrink-0 px-3 py-2 font-mono text-[12px] uppercase tracking-[0.12em] ${path === p.href ? "bg-tc text-fc" : "hover:underline"}`}>
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
