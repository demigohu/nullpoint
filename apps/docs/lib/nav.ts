export const PAGES = [
  { href: "/", label: "Overview" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/architecture", label: "Architecture" },
  { href: "/security", label: "Security model" },
  { href: "/verify", label: "Verify it live" },
  { href: "/run-it", label: "Run it yourself" },
] as const;

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/demigohu/nullpoint";
