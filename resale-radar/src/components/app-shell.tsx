"use client";

import {
  Bell, Bot, Boxes, Calculator, ChartLine, Gem, Handshake, LayoutDashboard, ListChecks, Map, Menu, Moon, Plus, Radar, ReceiptText,
  Search, Settings, Store, Sun, Telescope, Wallet, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "./ui";

export const NAV = [
  { href: "/", label: "Command Center", icon: LayoutDashboard },
  { href: "/radar", label: "Live Deal Radar", icon: Radar },
  { href: "/gems", label: "Hidden Gems", icon: Gem },
  { href: "/research", label: "Market Research", icon: Telescope },
  { href: "/analyzer", label: "Deal Analyzer", icon: Calculator },
  { href: "/negotiations", label: "Negotiation Center", icon: Handshake },
  { href: "/pickups", label: "Pickup Planner", icon: Map },
  { href: "/watchlists", label: "Watchlists", icon: ListChecks },
  { href: "/inventory", label: "Inventory", icon: Boxes },
  { href: "/sales", label: "Listings and Sales", icon: Store },
  { href: "/financials", label: "Financials", icon: Wallet },
  { href: "/analytics", label: "Analytics", icon: ChartLine },
  { href: "/advisor", label: "AI Advisor", icon: Bot },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const MOBILE_TABS = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/radar", label: "Radar", icon: Radar },
  { href: "/import", label: "Import", icon: Plus, primary: true },
  { href: "/negotiations", label: "Deals", icon: Handshake },
  { href: "/inventory", label: "Inventory", icon: Boxes },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/radar") return pathname.startsWith("/radar") || pathname.startsWith("/deals");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 px-2 font-semibold tracking-tight">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg">
        <Radar className="size-4" />
      </span>
      <span>Resale Radar</span>
    </Link>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  return (
    <button
      type="button"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("rr-theme", next ? "dark" : "light");
        } catch {}
      }}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={onNavigate}
          aria-current={isActive(pathname, href) ? "page" : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
            isActive(pathname, href) ? "bg-surface-2 font-medium text-fg" : "text-fg-muted hover:bg-surface-2/60 hover:text-fg",
          )}
        >
          <Icon className="size-4 shrink-0" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function AppShell({ children, unread, localMode }: { children: ReactNode; unread: number; localMode: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  if (pathname.startsWith("/onboarding") || pathname.startsWith("/login")) return <>{children}</>;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-4 border-r border-border bg-bg-subtle px-3 py-4 lg:flex">
        <Logo />
        <Link href="/import" className="mx-1 flex h-9 items-center justify-center gap-2 rounded-md bg-accent text-sm font-medium text-accent-fg hover:opacity-90">
          <Plus className="size-4" /> Import listing
        </Link>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <NavList pathname={pathname} />
        </div>
        {localMode ? (
          <p className="mx-1 rounded-md border border-border px-2.5 py-2 text-[11px] leading-snug text-fg-subtle">
            Local workspace. Data is stored on this machine. Connect Supabase for multi-device access.
          </p>
        ) : null}
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur sm:px-5">
          <button type="button" className="flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu className="size-5" />
          </button>
          <div className="lg:hidden">
            <Logo />
          </div>
          <form action="/radar" className="ml-auto hidden max-w-sm flex-1 sm:block lg:ml-0">
            <label className="relative block">
              <span className="sr-only">Search deals</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
              <input
                name="search"
                placeholder="Search deals"
                className="h-9 w-full rounded-md border border-border bg-bg-subtle pl-8 pr-3 text-sm placeholder:text-fg-subtle focus:border-accent focus:outline-none"
              />
            </label>
          </form>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/financials" className="hidden h-9 items-center gap-1.5 rounded-md px-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg md:flex">
              <ReceiptText className="size-4" /> Ledger
            </Link>
            <ThemeToggle />
            <Link href="/alerts" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg">
              <Bell className="size-4" />
              {unread > 0 ? (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg tabular">{unread > 99 ? "99+" : unread}</span>
              ) : null}
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-28 pt-5 sm:px-6 lg:pb-12">{children}</main>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/50 animate-in" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-4 border-r border-border bg-bg-subtle px-3 py-4 animate-in">
            <div className="flex items-center justify-between">
              <Logo />
              <button className="flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2" onClick={() => setOpen(false)} aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <form action="/radar">
              <input name="search" placeholder="Search deals" className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm placeholder:text-fg-subtle focus:border-accent focus:outline-none" />
            </form>
            <div className="flex-1 overflow-y-auto">
              <NavList pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 backdrop-blur lg:hidden" aria-label="Quick">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {MOBILE_TABS.map(({ href, label, icon: Icon, primary }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(pathname, href) ? "page" : undefined}
              className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", isActive(pathname, href) ? "text-fg" : "text-fg-subtle")}
            >
              {primary ? (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-fg">
                  <Icon className="size-4" />
                </span>
              ) : (
                <Icon className="size-5" />
              )}
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
